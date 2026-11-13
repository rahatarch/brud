import type {
  IKernelAccessBroker,
  IStorageDriver,
  KernelServiceModuleContext,
  ServiceContext,
} from '@brud/kernel';
import { FileMutationJournalToken } from '../BrudFileSystem/descriptor/journalTokens.js';
import type {
  FileMutationEvent,
  FileMutationListener,
  IFileMutationJournal,
} from '../BrudFileSystem/events/types.js';
import {
  HISTORY_CONTEXT_SCOPE,
  HISTORY_ROOT_CONTEXT_FIELD,
} from './bootOptions.js';
import { UniversalHistoryToken } from './descriptor/tokens.js';
import type { PluginHistoryFacade } from './unified/adapters/PluginHistoryFacade.js';
import { createUnifiedHistoryDescriptors } from './unified/descriptor/unifiedHistoryDescriptors.js';

/** History storage overrides read from the generic options bag. */
interface HistoryOptions {
  readonly inMemory?: boolean;
  readonly dbPath?: string;
  /**
   * When false, the service starts session-only and installs no journal
   * listener. The filesystem journal then has no listener, so it skips
   * mutation capture. Defaults to true.
   */
  readonly recordMutations?: boolean;
}

type HistoryDescriptors = ReturnType<typeof createUnifiedHistoryDescriptors>;

const HISTORY_SLOT = 'brud.core.history.descriptors';
const HISTORY_CONTRACT_SLOT = 'brud.core.history.contract';

/**
 * Per-kernel state used to defer the journal handoff to the boot window.
 *
 * The journal is the filesystem service's exposed API. History resolves it
 * through the access broker while the kernel's lifecycle gate is suspended for
 * the boot pinner, so no boot-bag key carries it and the kernel never sees it.
 */
interface HistoryRuntime {
  readonly resolved: {
    driver?: IStorageDriver;
    journal?: IFileMutationJournal;
  };
  readonly recordMutations: boolean;
  broker?: IKernelAccessBroker;
  facade?: PluginHistoryFacade;
  started: boolean;
}

const RUNTIMES = new WeakMap<KernelServiceModuleContext, HistoryRuntime>();

/** Builds a journal handle that resolves the filesystem API on first use. */
function lazyJournal(runtime: HistoryRuntime): IFileMutationJournal {
  return {
    get enabled(): boolean {
      return runtime.resolved.journal?.enabled ?? false;
    },
    publish(event: FileMutationEvent): void {
      runtime.resolved.journal?.publish(event);
    },
    subscribe(listener: FileMutationListener): () => void {
      const resolved = runtime.resolved.journal;

      if (resolved === undefined) {
        throw new Error(
          'brud.core.history resolved the journal before the boot-snapshot window',
        );
      }

      return resolved.subscribe(listener);
    },
  };
}

/**
 * Builds a storage-driver handle that resolves the filesystem API on first use.
 *
 * Construction of the history store never touches the driver; the first use is
 * `start()`, which runs in the boot-snapshot window after the API is resolved.
 */
function lazyDriver(runtime: HistoryRuntime): IStorageDriver {
  return new Proxy({} as IStorageDriver, {
    get(_target, property): unknown {
      const resolved = runtime.resolved.driver;

      if (resolved === undefined) {
        throw new Error(
          'brud.core.history resolved the storage driver before the boot-snapshot window',
        );
      }

      const value = (resolved as unknown as Record<PropertyKey, unknown>)[property];

      if (typeof value !== 'function') {
        return value;
      }

      const method = value as (...args: unknown[]) => unknown;

      return method.bind(resolved);
    },
  });
}

/**
 * Builds the shared history descriptor pair once per kernel.
 *
 * Both `historySession` and `historyJournal` config entries call this; the
 * per-kernel `shared` bag holds the single pair so the session and journal
 * descriptors close over the same runtime.
 */
function historyDescriptorsFor(context: KernelServiceModuleContext): HistoryDescriptors {
  if (context.shared[HISTORY_CONTRACT_SLOT] !== true) {
    context.declareContextFields(HISTORY_CONTEXT_SCOPE, [
      {
        name: HISTORY_ROOT_CONTEXT_FIELD,
        type: 'string',
        required: true,
        description: 'Absolute workspace root that contains the history store.',
      },
    ]);
    context.shared[HISTORY_CONTRACT_SLOT] = true;
  }

  const existing = context.shared[HISTORY_SLOT] as HistoryDescriptors | undefined;

  if (existing !== undefined) {
    return existing;
  }

  const options = context.options['history'] as HistoryOptions | undefined;
  const recordMutations = options?.recordMutations !== false;
  const runtime: HistoryRuntime = { resolved: {}, recordMutations, started: false };
  RUNTIMES.set(context, runtime);

  const descriptors = createUnifiedHistoryDescriptors({
    driver: lazyDriver(runtime),
    ...(recordMutations ? { journal: lazyJournal(runtime) } : {}),
    deferStart: true,
    ...(options?.inMemory === true ? { inMemory: true } : {}),
    ...(options?.dbPath === undefined ? {} : { dbPath: options.dbPath }),
  });

  const sessionBase = descriptors.session;
  const session: typeof sessionBase = {
    ...sessionBase,
    factory: (serviceContext, broker) => {
      runtime.broker = broker;
      const facade = sessionBase.factory(serviceContext, broker);
      runtime.facade = facade;

      return facade;
    },
  };

  const resolvedDescriptors: HistoryDescriptors = {
    session,
    journal: descriptors.journal,
  };

  context.shared[HISTORY_SLOT] = resolvedDescriptors;

  return resolvedDescriptors;
}

export function createHistorySessionService(context: KernelServiceModuleContext) {
  return historyDescriptorsFor(context).session;
}

export function createHistoryJournalService(context: KernelServiceModuleContext) {
  return historyDescriptorsFor(context).journal;
}

export function createService(context: KernelServiceModuleContext) {
  return createHistorySessionService(context);
}

/**
 * Resolves the filesystem-owned journal API during the boot-snapshot window.
 *
 * The kernel suspends the lifecycle gate around this hook. Access policies
 * still apply: the filesystem's grant is the only reason history may resolve
 * the journal. The hook runs once per kernel; later invocations are no-ops.
 */
export async function pinBootPolicies(
  context: KernelServiceModuleContext,
): Promise<void> {
  const runtime = RUNTIMES.get(context);

  if (runtime === undefined || runtime.started) {
    return;
  }

  const broker = runtime.broker;
  const facade = runtime.facade;

  if (broker === undefined || facade === undefined) {
    throw new Error(
      'brud.core.history boot snapshot ran before its descriptors were constructed',
    );
  }

  const caller: ServiceContext = {
    callerId: UniversalHistoryToken.id,
    tier: 'core',
    options: context.options,
  };
  const mutation = broker.requestAccess(caller, FileMutationJournalToken);

  runtime.resolved.driver = mutation.driver;

  if (runtime.recordMutations) {
    runtime.resolved.journal = mutation.journal;
  }

  await facade.start();
  runtime.started = true;
}