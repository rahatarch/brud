/**
 * Kernel descriptors for the unified history engine (D-15).
 *
 * One `UnifiedHistoryService` + `ReversalEngine` backs both existing tokens:
 * - `brud.core.universalHistory` → `LegacySessionAdapter` (sessions, revert)
 * - `brud.core.history`          → `LegacyJournalAdapter` (undo/redo/checkpoints)
 *
 * Registered by `createStandardKernel()`; the only history engine since D-15 U-7.
 */
import { join } from 'node:path';
import type { IStorageDriver } from '../../../../drivers/contracts/index.js';
import type { IKernelAccessBroker } from '../../../../src/contracts/accessBroker.js';
import type { ServiceContext } from '../../../../src/contracts/lifecycle.js';
import type { ServiceDescriptor } from '../../../../src/contracts/serviceDescriptor.js';
import type { IBrudFileSystem } from '../../../BrudFileSystem/contracts/IBrudFileSystem/IBrudFileSystem.js';
import { FileSystemToken } from '../../../BrudFileSystem/descriptor/tokens.js';
import { SettingsReaderToken } from '../../../SettingsService/descriptor/tokens.js';
import type { IFileMutationJournal } from '../../../BrudFileSystem/events/types.js';
import type { IUniversalHistory } from '../../contracts/IUniversalHistory.js';
import type { IUniversalHistoryService } from '../../contracts/IUniversalHistoryService/IUniversalHistoryService.js';
import { ReadOnlyHistoryFacade } from '../../descriptor/ReadOnlyHistoryFacade.js';
import { HistoryToken, UniversalHistoryToken } from '../../descriptor/tokens.js';
import { LegacyJournalAdapter } from '../compat/LegacyJournalAdapter.js';
import { LegacySessionAdapter } from '../compat/LegacySessionAdapter.js';
import { ReversalEngine } from '../engine/ReversalEngine.js';
import { UnifiedHistoryService } from '../service/UnifiedHistoryService.js';
import type { HistoryRetentionReport } from '../service/UnifiedHistoryService.js';
import { UnifiedHistoryStore } from '../store/UnifiedHistoryStore.js';

export const UNIFIED_HISTORY_DB_RELATIVE_PATH = '.brud/history/universal.db';

export interface UnifiedHistoryDescriptorOptions {
  readonly driver: IStorageDriver;
  readonly journal: IFileMutationJournal;
  /** Keep the database in memory (tests); blobs still go through `driver`. */
  readonly inMemory?: boolean;
  /** Absolute database path override. */
  readonly dbPath?: string;
  readonly callbackTimeoutMs?: number;
  /** Most file entries retention removes per boot (default 50,000). */
  readonly retentionBudget?: number;
  /** Observer for each boot's retention report (tests, diagnostics). */
  readonly onRetention?: (report: HistoryRetentionReport) => void;
}

interface Runtime {
  readonly service: UnifiedHistoryService;
  readonly engine: ReversalEngine;
}

export function createUnifiedHistoryDescriptors(options: UnifiedHistoryDescriptorOptions): {
  readonly session: ServiceDescriptor<IUniversalHistoryService, LegacySessionAdapter>;
  readonly journal: ServiceDescriptor<IUniversalHistory, LegacyJournalAdapter>;
} {
  let runtime: Runtime | undefined;

  const session: ServiceDescriptor<IUniversalHistoryService, LegacySessionAdapter> = {
    token: UniversalHistoryToken,
    tier: 'core',
    dependencies: [FileSystemToken],
    factory: (context: ServiceContext, broker: IKernelAccessBroker): LegacySessionAdapter => {
      const historyRoot = join(context.workspaceRoot, '.brud', 'history');
      let fileSystem: IBrudFileSystem | undefined;
      const resolveFileSystem = (): IBrudFileSystem => {
        fileSystem ??= broker.requestAccess(
          { callerId: UniversalHistoryToken.id, tier: 'core', workspaceRoot: context.workspaceRoot },
          FileSystemToken,
        );
        return fileSystem;
      };
      const store = new UnifiedHistoryStore({
        dbPath: options.dbPath ?? (options.inMemory === true ? ':memory:' : join(context.workspaceRoot, UNIFIED_HISTORY_DB_RELATIVE_PATH)),
        historyRoot,
        driver: options.driver,
        onWarning: (warning) => {
          context.logger?.warn(warning.message, { code: warning.code, reason: warning.reason });
        },
      });
      const service = new UnifiedHistoryService({
        store,
        fileSystem: resolveFileSystem,
        journal: options.journal,
        driver: options.driver,
        importLegacy: options.inMemory !== true && options.dbPath === undefined,
        onError: (error, details) => {
          // D9': a replacement implicit session is a self-healed condition, not
          // a recording failure; it gets its own code so a genuine recording
          // failure stays unambiguous (and R2 can assert its absence).
          if (details.phase === 'session-recovered') {
            context.logger?.warn('Universal history replaced a lost implicit session', {
              code: 'HISTORY_SESSION_RECOVERED',
              error: error instanceof Error ? error.message : String(error),
              ...details,
            });
            return;
          }
          const importing = details.phase === 'legacy-import';
          context.logger?.warn(importing ? 'Legacy history import did not complete' : 'Universal history could not record a mutation', {
            code: importing ? 'HISTORY_IMPORT_FAILED' : 'HISTORY_RECORDING_FAILED',
            error: error instanceof Error ? error.message : String(error),
            ...details,
          });
        },
      });
      const engine = new ReversalEngine({
        service,
        fileSystem: resolveFileSystem,
        ...(options.callbackTimeoutMs === undefined ? {} : { callbackTimeoutMs: options.callbackTimeoutMs }),
      });
      runtime = { service, engine };
      // Retention runs once per boot, after RUNNING (the settings snapshot is
      // only readable then) and before plugins activate. It never fails boot:
      // without readable settings, nothing is removed.
      const retain = async (): Promise<void> => {
        if (!broker.hasService(SettingsReaderToken)) {
          return;
        }
        try {
          const settings = broker.requestAccess(
            { callerId: UniversalHistoryToken.id, tier: 'core', workspaceRoot: context.workspaceRoot },
            SettingsReaderToken,
          ).getSnapshot();
          const report = await service.runRetention({
            retentionDays: settings.historyRetentionDays,
            minUndoEntries: settings.historyMinUndoEntries,
            ...(options.retentionBudget === undefined ? {} : { maxEntriesPerRun: options.retentionBudget }),
          });
          options.onRetention?.(report);
        } catch (error) {
          context.logger?.warn('History retention did not complete', {
            code: 'HISTORY_RETENTION_FAILED',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      };
      return new LegacySessionAdapter(service, engine, retain);
    },
  };

  const journal: ServiceDescriptor<IUniversalHistory, LegacyJournalAdapter> = {
    token: HistoryToken,
    tier: 'core',
    dependencies: [UniversalHistoryToken],
    accessPolicy: { deniedCallers: [] },
    factory: (): LegacyJournalAdapter => {
      if (runtime === undefined) {
        throw new Error('brud.core.universalHistory must be constructed before brud.core.history');
      }
      return new LegacyJournalAdapter(runtime.service, runtime.engine);
    },
    project: (instance: LegacyJournalAdapter, caller: ServiceContext): IUniversalHistory =>
      caller.tier === 'core' ? instance : new ReadOnlyHistoryFacade(instance),
  };

  return { session, journal };
}
