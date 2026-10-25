import { join } from 'node:path';
import type { IKernelAccessBroker } from '../../../src/contracts/accessBroker.js';
import type {
  KernelLogger,
  ServiceContext,
  ServiceTier,
} from '../../../src/contracts/lifecycle.js';
import type { ServiceDescriptor } from '../../../src/contracts/serviceDescriptor.js';
import type { IBrudFileSystem } from '../../BrudFileSystem/contracts/IBrudFileSystem/IBrudFileSystem.js';
import { FileSystemToken } from '../../BrudFileSystem/descriptor/tokens.js';
import type {
  FileMutationEvent,
  IFileMutationJournal,
} from '../../BrudFileSystem/events/types.js';
import { SettingsReaderToken } from '../../SettingsService/descriptor/tokens.js';
import { WorkspaceToken } from '../../WorkspaceService/descriptor/tokens.js';
import type { IUniversalHistory } from '../contracts/IUniversalHistory.js';
import { LazyFileSystem } from '../orchestrator/LazyFileSystem.js';
import { UniversalHistory } from '../orchestrator/UniversalHistory.js';
import {
  IN_MEMORY_HISTORY_DB_PATH,
  SqliteHistoryStorage,
} from '../storage/SqliteHistoryStorage.js';
import { ReadOnlyHistoryFacade } from './ReadOnlyHistoryFacade.js';
import { HistoryToken } from './tokens.js';

/** Primary database path, relative to the workspace root. */
export const HISTORY_DB_RELATIVE_PATH = '.brud/history/history.db';

/** Content-addressed blob directory, relative to the workspace root. */
export const HISTORY_BLOB_DIR_RELATIVE_PATH = '.brud/history/blobs';

/** Tier assigned to the journal-driven history descriptor. */
export const HISTORY_SERVICE_TIER: ServiceTier = 'core';

/** Caller id that receives the `.brud/history` trusted write scope. */
export const HISTORY_CALLER_ID = 'brud.core.history';

/** Construction options for {@link createHistoryDescriptor}. */
export interface HistoryDescriptorOptions {
  /** Absolute `history.db` path. Takes precedence over {@link inMemory}. */
  readonly dbPath?: string;

  /** Absolute blob directory. Defaults to `.brud/history/blobs`. */
  readonly blobDir?: string;

  /**
   * Uses an anonymous in-memory database. Intended for ephemeral kernels and
   * tests whose workspace root is not a real directory.
   */
  readonly inMemory?: boolean;

  /** Mutation journal to consume. Typically the filesystem's shared journal. */
  readonly journal?: IFileMutationJournal;

  /**
   * Diagnostic sink for non-fatal failures. Defaults to `context.logger`
   * supplied by the booting kernel.
   */
  readonly logger?: KernelLogger;

  /** Additional sink receiving journal ingestion failures. */
  readonly onIngestionError?: (error: unknown, event?: FileMutationEvent) => void;
}

/** Renders an error for a diagnostic warning without leaking stack traces. */
function errorMeta(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;

    return {
      name: error.name,
      message: error.message,
      ...(typeof code === 'string' ? { code } : {}),
    };
  }

  return { message: String(error) };
}

/**
 * Builds the journal-driven history descriptor.
 *
 * The filesystem is resolved through the access broker on first use because
 * descriptors are constructed while the kernel is still `BOOTING` and the
 * broker refuses access until `RUNNING`.
 */
export function createHistoryDescriptor(
  options?: HistoryDescriptorOptions,
): ServiceDescriptor<IUniversalHistory, UniversalHistory> {
  return {
    token: HistoryToken,
    tier: HISTORY_SERVICE_TIER,
    dependencies: [FileSystemToken, WorkspaceToken, SettingsReaderToken],
    accessPolicy: { deniedCallers: [] },
    factory: (
      context: ServiceContext,
      broker: IKernelAccessBroker,
    ): UniversalHistory => {
      const inMemory = options?.inMemory === true;
      const dbPath = options?.dbPath
        ?? (inMemory
          ? IN_MEMORY_HISTORY_DB_PATH
          : join(context.workspaceRoot, HISTORY_DB_RELATIVE_PATH));
      const blobDir = options?.blobDir
        ?? (inMemory
          ? undefined
          : join(context.workspaceRoot, HISTORY_BLOB_DIR_RELATIVE_PATH));
      const logger = options?.logger ?? context.logger;
      const storage = new SqliteHistoryStorage({
        dbPath,
        ...(blobDir === undefined ? {} : { blobDir }),
        blobRefPrefix: HISTORY_BLOB_DIR_RELATIVE_PATH,
      });

      if (storage.isDegraded) {
        // Read-only history must never fail kernel boot. Ingestion becomes a
        // no-op and reversals throw HistoryDegradedError, so the diagnostic is
        // the only signal that durability is unavailable.
        logger?.warn(
          'brud.core.history: history storage is read-only; running in degraded mode',
          {
            code: 'HISTORY_DEGRADED',
            reason: storage.degradedReason ?? 'READ_ONLY_STORAGE',
            database: inMemory ? IN_MEMORY_HISTORY_DB_PATH : HISTORY_DB_RELATIVE_PATH,
          },
        );
      }

      const reportIngestionError = (
        error: unknown,
        event?: FileMutationEvent,
      ): void => {
        options?.onIngestionError?.(error, event);
        logger?.warn('brud.core.history: journal ingestion failed', {
          ...errorMeta(error),
          ...(event === undefined
            ? {}
            : {
              path: event.path,
              mutationId: event.mutationId,
              operation: event.operation,
            }),
        });
      };
      const fileSystem = new LazyFileSystem(
        (): IBrudFileSystem => broker.requestAccess(
          {
            callerId: HISTORY_CALLER_ID,
            tier: HISTORY_SERVICE_TIER,
            workspaceRoot: context.workspaceRoot,
          },
          FileSystemToken,
        ),
      );

      return new UniversalHistory({
        storage,
        fileSystem,
        onIngestionError: reportIngestionError,
        ...(options?.journal === undefined ? {} : { journal: options.journal }),
      });
    },
    project: (
      instance: UniversalHistory,
      caller: ServiceContext,
    ): IUniversalHistory => caller.tier === 'core'
      ? instance
      : new ReadOnlyHistoryFacade(instance),
  };
}
