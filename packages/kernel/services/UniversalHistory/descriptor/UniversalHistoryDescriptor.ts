import { join } from 'node:path';
import type { IKernelAccessBroker } from '../../../src/contracts/accessBroker.js';
import type {
  ServiceContext,
  ServiceTier,
} from '../../../src/contracts/lifecycle.js';
import type { ServiceDescriptor } from '../../../src/contracts/serviceDescriptor.js';
import type { IBrudFileSystem } from '../../BrudFileSystem/contracts/IBrudFileSystem/IBrudFileSystem.js';
import { FileSystemToken } from '../../BrudFileSystem/descriptor/tokens.js';
import type { IUniversalHistoryService } from '../contracts/IUniversalHistoryService/IUniversalHistoryService.js';
import { LazyFileSystem } from '../orchestrator/LazyFileSystem.js';
import { UniversalHistoryService } from '../orchestrator/UniversalHistoryService.js';
import {
  IN_MEMORY_DB_PATH,
  SqliteLedger,
} from '../storage/SqliteLedger/index.js';
import { IdAllocator } from '../storage/IdAllocator/IdAllocator.js';
import { UniversalHistoryToken } from './tokens.js';

/** Ledger path, relative to the workspace root. */
export const HISTORY_LEDGER_RELATIVE_PATH = '.brud/history/ledger.db';

/** Session sequence file, relative to the workspace root. */
export const HISTORY_SEQUENCE_RELATIVE_PATH = '.brud/history/seq.json';

/** Tier assigned to the history service descriptor. */
export const HISTORY_SERVICE_TIER: ServiceTier = 'core';

export interface UniversalHistoryDescriptorOptions {
  /**
   * Absolute SQLite database path. Takes precedence over {@link inMemory}.
   */
  readonly dbPath?: string;
  /**
   * Uses `:memory:` instead of `.brud/history/ledger.db`. Intended for tests
   * and ephemeral kernels whose workspace root is not a real directory.
   */
  readonly inMemory?: boolean;
}

const HISTORY_CALLER_ID = UniversalHistoryToken.id;

/**
 * Builds the history service descriptor.
 *
 * The filesystem dependency is resolved through the access broker only when
 * the first operation runs. Descriptor factories execute during `BOOTING`,
 * and the broker refuses access until the kernel reaches `RUNNING`, so eager
 * resolution here would break boot.
 */
export function createUniversalHistoryDescriptor(
  options?: UniversalHistoryDescriptorOptions,
): ServiceDescriptor<IUniversalHistoryService, UniversalHistoryService> {
  return {
    token: UniversalHistoryToken,
    tier: HISTORY_SERVICE_TIER,
    dependencies: [FileSystemToken],
    factory: (
      context: ServiceContext,
      broker: IKernelAccessBroker,
    ): UniversalHistoryService => {
      const dbPath = options?.dbPath
        ?? (options?.inMemory === true
          ? IN_MEMORY_DB_PATH
          : join(context.workspaceRoot, HISTORY_LEDGER_RELATIVE_PATH));
      const ledger = new SqliteLedger({ dbPath });
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
      const idAllocator = new IdAllocator(fileSystem, {
        sequenceFile: HISTORY_SEQUENCE_RELATIVE_PATH,
      });

      return new UniversalHistoryService({ ledger, fileSystem, idAllocator });
    },
  };
}
