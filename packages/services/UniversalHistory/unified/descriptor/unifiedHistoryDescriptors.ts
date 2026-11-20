/**
 * Kernel descriptors for the unified history engine (D-15).
 *
 * One `UnifiedHistoryService` + `ReversalEngine` backs both existing tokens:
 * - `brud.core.universalHistory` → `PluginHistoryFacade` (sessions, revert)
 * - `brud.core.history`          → `JournalAdapter` (undo/redo/checkpoints)
 *
 * Registered by `createStandardKernel()`; the only history engine since D-15 U-7.
 */
import { join } from 'node:path';
import type { IStorageDriver } from '../../../BrudFileSystem/contracts/index.js';
import type { ExposedApiCaller } from '@brud/kernel';
import { kernelParticipant } from './kernelParticipant.js';
import type { ServiceDescriptor, ServiceToken } from '@brud/kernel';
import type { IBrudFileSystem } from '../../../BrudFileSystem/contracts/IBrudFileSystem/IBrudFileSystem.js';
import { FILESYSTEM_JOURNAL_EXPOSURE } from '../../../BrudFileSystem/contracts/exposure.js';
import type { SettingsSnapshot } from '../../../SettingsService/contracts/ISettingsService.js';
import type { IFileMutationJournal } from '../../../BrudFileSystem/events/types.js';
import type { IUniversalHistory } from '../../contracts/IUniversalHistory.js';
import type { IUniversalHistoryService } from '../../contracts/IUniversalHistoryService/IUniversalHistoryService.js';
import {
  HISTORY_FILESYSTEM_EXPOSURE,
  HISTORY_JOURNAL_EXPOSURE,
  HISTORY_READ_CAPABILITY,
  HISTORY_SETTINGS_READER_EXPOSURE,
  HISTORY_WRITE_CAPABILITY,
  NAMESPACE_HISTORY_EXPOSURE,
  UNIVERSAL_HISTORY_EXPOSURE,
} from '../../contracts/exposure.js';
import { ReadOnlyHistoryFacade } from '../../descriptor/ReadOnlyHistoryFacade.js';
import { ReadOnlyUniversalHistoryFacade } from '../../descriptor/ReadOnlyUniversalHistoryFacade.js';
import { HistoryToken, UniversalHistoryToken } from '../../descriptor/tokens.js';
import { requireContextString } from '@brud/kernel';
import { HISTORY_ROOT_CONTEXT_FIELD } from '../../bootOptions.js';
import { JournalAdapter } from '../adapters/JournalAdapter.js';
import { PluginHistoryFacade, namespaceHistoryFor } from '../adapters/PluginHistoryFacade.js';
import { ReversalEngine } from '../engine/ReversalEngine.js';
import { createReadOnlyNamespaceHandle } from '../service/NamespaceHandle.js';
import { UnifiedHistoryService } from '../service/UnifiedHistoryService.js';
import type { HistoryRetentionReport } from '../service/UnifiedHistoryService.js';
import { UnifiedHistoryStore } from '../store/UnifiedHistoryStore.js';

export const UNIFIED_HISTORY_DB_RELATIVE_PATH = '.brud/history/universal.db';

export interface UnifiedHistoryDescriptorOptions {
  readonly driver: IStorageDriver;
  /**
   * Mutation source to record.
   *
   * Omitted for a session-only history service: the store still starts and
   * serves explicit sessions, but no journal listener is installed.
   */
  readonly journal?: IFileMutationJournal;
  /** Keep the database in memory (tests); blobs still go through `driver`. */
  readonly inMemory?: boolean;
  /** Absolute database path override. */
  readonly dbPath?: string;
  readonly callbackTimeoutMs?: number;
  /** Most file entries retention removes per boot (default 50,000). */
  readonly retentionBudget?: number;
  /** Observer for each boot's retention report (tests, diagnostics). */
  readonly onRetention?: (report: HistoryRetentionReport) => void;
  /**
   * Defers `start()` to the kernel's boot-snapshot window.
   *
   * The standard composition sets this because the journal API is resolved
   * through the broker while the lifecycle gate is suspended. Direct callers
   * that supply a concrete journal keep the default and start in
   * `initialize()`.
   */
  readonly deferStart?: boolean;

  /**
   * Subscribe to the filesystem's `brud.filesystem.journal` exposure once
   * running (replaces `journal`), then start a deferred facade.
   */
  readonly resolveJournal?: boolean;
}

interface Runtime {
  readonly service: UnifiedHistoryService;
  readonly engine: ReversalEngine;
}

export function createUnifiedHistoryDescriptors(options: UnifiedHistoryDescriptorOptions): {
  readonly session: ServiceDescriptor<IUniversalHistoryService, PluginHistoryFacade>;
  readonly journal: ServiceDescriptor<IUniversalHistory, JournalAdapter>;
} {
  let runtime: Runtime | undefined;

  let facadeRef: PluginHistoryFacade | undefined;
  // A deferred store starts in onRunning; retention waits for it.
  let started = options.deferStart !== true;
  let warmFileSystem: (() => void) | undefined;
  let resolvedJournal: { subscribe: IFileMutationJournal['subscribe'] } | undefined;
  const listeners = new Set<Parameters<IFileMutationJournal['subscribe']>[0]>();
  const replayed = new Map<Parameters<IFileMutationJournal['subscribe']>[0], () => void>();
  // Lazy journal over the resolved exposure: subscriptions made before RUNNING
  // are replayed onto the exposure once it resolves.
  const exposureJournal: IFileMutationJournal = {
    get enabled(): boolean {
      return resolvedJournal !== undefined;
    },
    publish(): void {
      throw new Error('brud.core.universalHistory never publishes file mutations');
    },
    subscribe(listener) {
      listeners.add(listener);
      const off = resolvedJournal?.subscribe(listener);

      return (): void => {
        listeners.delete(listener);
        off?.();
        replayed.get(listener)?.();
        replayed.delete(listener);
      };
    },
  };
  const journalOption = options.resolveJournal === true ? exposureJournal : options.journal;
  let retain: (() => Promise<void>) | undefined;
  let retentionPending = false;

  const fullOrReadOnly = (instance: PluginHistoryFacade, caller: ExposedApiCaller): IUniversalHistoryService => (
    caller.capabilities.has(HISTORY_WRITE_CAPABILITY) && caller.official
      ? instance
      : new ReadOnlyUniversalHistoryFacade(instance)
  );
  const namespaceFor = (instance: PluginHistoryFacade, caller: ExposedApiCaller): object => {
    const subject = caller.identity ?? caller.callerClass;
    const handle = namespaceHistoryFor(instance, subject, { official: caller.official });

    if (handle === undefined) {
      throw new Error(`Namespace history requires the unified history engine (participant "${subject}")`);
    }

    return (caller.capabilities.has(HISTORY_WRITE_CAPABILITY) ? handle : createReadOnlyNamespaceHandle(handle)) as object;
  };
  const historyPolicy = { policyVersion: 2, capabilities: [HISTORY_READ_CAPABILITY] };

  const sessionBase = kernelParticipant<PluginHistoryFacade>({
    token: UniversalHistoryToken as unknown as ServiceToken<PluginHistoryFacade>,
    tier: 'core',
    requests: ['fs:read', 'fs:write'],
    exposes: {
      [UNIVERSAL_HISTORY_EXPOSURE]: {
        version: 1,
        scope: 'runtime',
        policy: historyPolicy,
        handle: (caller, ctx) => fullOrReadOnly(ctx.instance, caller),
      },
      [NAMESPACE_HISTORY_EXPOSURE]: {
        version: 1,
        scope: 'runtime',
        policy: historyPolicy,
        handle: (caller, ctx) => namespaceFor(ctx.instance, caller),
      },
    },
    create: (ctx) => {
      const workspaceRoot = requireContextString(
        ctx.bootOptions,
        HISTORY_ROOT_CONTEXT_FIELD,
        UniversalHistoryToken.id,
      );
      const historyRoot = join(workspaceRoot, '.brud', 'history');
      let fileSystem: IBrudFileSystem | undefined;
      warmFileSystem = (): void => {
        fileSystem ??= ctx.resolve<IBrudFileSystem>(HISTORY_FILESYSTEM_EXPOSURE) ?? undefined;
      };
      const resolveFileSystem = (): IBrudFileSystem => {
        fileSystem ??= ctx.resolve<IBrudFileSystem>(HISTORY_FILESYSTEM_EXPOSURE) ?? undefined;

        if (fileSystem === undefined) {
          throw new Error(`${UniversalHistoryToken.id}: ${HISTORY_FILESYSTEM_EXPOSURE} is not resolvable`);
        }

        return fileSystem;
      };
      const store = new UnifiedHistoryStore({
        dbPath: options.dbPath ?? (options.inMemory === true ? ':memory:' : join(workspaceRoot, UNIFIED_HISTORY_DB_RELATIVE_PATH)),
        historyRoot,
        driver: options.driver,
        onWarning: (warning) => {
          ctx.logger?.warn(warning.message, { code: warning.code, reason: warning.reason });
        },
      });
      const service = new UnifiedHistoryService({
        store,
        fileSystem: resolveFileSystem,
        journal: journalOption,
        driver: options.driver,
        importPreviousHistory: options.inMemory !== true && options.dbPath === undefined,
        onError: (error, details) => {
          // D9': a replacement implicit session is a self-healed condition, not
          // a recording failure; it gets its own code so a genuine recording
          // failure stays unambiguous (and R2 can assert its absence).
          if (details.phase === 'session-recovered') {
            ctx.logger?.warn('Universal history replaced a lost implicit session', {
              code: 'HISTORY_SESSION_RECOVERED',
              error: error instanceof Error ? error.message : String(error),
              ...details,
            });
            return;
          }
          const importing = details.phase === 'history-import';
          ctx.logger?.warn(importing ? 'Previous history import did not complete' : 'Universal history could not record a mutation', {
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
      retain = async (): Promise<void> => {
        // resolve is live only once RUNNING: a pre-RUNNING start defers retention to onRunning.
        if (!ctx.running || !started) {
          retentionPending = true;
          return;
        }
        const reader = ctx.resolve<{ getSnapshot(): SettingsSnapshot }>(HISTORY_SETTINGS_READER_EXPOSURE);
        if (reader === null) {
          return;
        }
        try {
          const settings = reader.getSnapshot();
          const report = await service.runRetention({
            retentionDays: settings.historyRetentionDays,
            minUndoEntries: settings.historyMinUndoEntries,
            ...(options.retentionBudget === undefined ? {} : { maxEntriesPerRun: options.retentionBudget }),
          });
          options.onRetention?.(report);
        } catch (error) {
          ctx.logger?.warn('History retention did not complete', {
            code: 'HISTORY_RETENTION_FAILED',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      };
      const facade = new PluginHistoryFacade(
        service,
        engine,
        retain,
        options.deferStart === true,
      );

      facadeRef = facade;

      return facade;
    },
    onRunning: async (ctx) => {
      warmFileSystem?.();

      if (options.resolveJournal === true && resolvedJournal === undefined) {
        // Resolved on this participant's runtime chain; official-only exposure.
        resolvedJournal = ctx.resolve<{ subscribe: IFileMutationJournal['subscribe'] }>(FILESYSTEM_JOURNAL_EXPOSURE) ?? undefined;

        if (resolvedJournal === undefined) {
          ctx.logger?.warn('Universal history cannot record mutations: brud.filesystem.journal is not resolvable', {
            code: 'HISTORY_JOURNAL_UNAVAILABLE',
          });
        } else {
          for (const listener of listeners) {
            replayed.set(listener, resolvedJournal.subscribe(listener));
          }
        }
      }

      if (options.deferStart === true && facadeRef !== undefined && !started) {
        await facadeRef.start();
        started = true;
      }

      if (retentionPending && retain !== undefined) {
        retentionPending = false;
        await retain();
      }
    },
  });

  const session = sessionBase as unknown as ServiceDescriptor<IUniversalHistoryService, PluginHistoryFacade>;

  let adapter: JournalAdapter | undefined;
  const adapterOf = (): JournalAdapter => {
    if (runtime === undefined) {
      throw new Error('brud.core.history used before brud.core.universalHistory was constructed');
    }

    adapter ??= new JournalAdapter(runtime.service, runtime.engine);

    return adapter;
  };
  // Lazy: the session participant may be constructed after this one.
  const lazyAdapter = new Proxy({} as JournalAdapter, {
    get: (_target, property): unknown => {
      const real = adapterOf();
      const value = Reflect.get(real, property, real) as unknown;

      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(real) : value;
    },
  });
  const journal = kernelParticipant<JournalAdapter>({
    token: HistoryToken as unknown as ServiceToken<JournalAdapter>,
    tier: 'core',
    exposes: {
      [HISTORY_JOURNAL_EXPOSURE]: {
        version: 1,
        scope: 'runtime',
        policy: historyPolicy,
        handle: (caller) => (caller.official && caller.capabilities.has(HISTORY_WRITE_CAPABILITY)
          ? lazyAdapter
          : new ReadOnlyHistoryFacade(lazyAdapter)),
      },
    },
    create: () => lazyAdapter,
  }) as unknown as ServiceDescriptor<IUniversalHistory, JournalAdapter>;

  return { session, journal };
}
