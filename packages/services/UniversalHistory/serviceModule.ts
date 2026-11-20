/**
 * UniversalHistory service module: two participants (`brud.core.universalHistory`
 * session and `brud.core.history` journal) built once per composition. The
 * filesystem's mutation feed is reached through `brud.filesystem.journal`; the
 * storage driver comes from the startup options, never from another
 * participant.
 */
import type { KernelServiceModuleContext } from '@brud/kernel';
import type { IStorageDriver } from '../BrudFileSystem/contracts/index.js';
import { DurableNodeStorageDriver } from '../BrudFileSystem/drivers/DurableNodeStorageDriver.js';
import { HISTORY_CONTEXT_SCOPE, HISTORY_ROOT_CONTEXT_FIELD } from './bootOptions.js';
import { createUnifiedHistoryDescriptors } from './unified/descriptor/unifiedHistoryDescriptors.js';

/** History storage overrides read from the generic options bag. */
interface HistoryOptions {
  readonly inMemory?: boolean;
  readonly dbPath?: string;
  readonly recordMutations?: boolean;
  readonly driver?: IStorageDriver;
}

type HistoryDescriptors = ReturnType<typeof createUnifiedHistoryDescriptors>;

// The two module entries (session, journal) share one build through the
// composition's module bag, as before this refactor.
const HISTORY_SLOT = 'brud.core.history.descriptors';

function historyDescriptorsFor(context: KernelServiceModuleContext): HistoryDescriptors {
  const existing = context.shared[HISTORY_SLOT] as HistoryDescriptors | undefined;

  if (existing !== undefined) {
    return existing;
  }

  context.declareContextFields(HISTORY_CONTEXT_SCOPE, [
    {
      name: HISTORY_ROOT_CONTEXT_FIELD,
      type: 'string',
      required: true,
      description: 'Absolute workspace root that contains the history store.',
    },
  ]);

  const options = context.options['history'] as HistoryOptions | undefined;
  const driver = options?.driver
    ?? (context.options['storageDriver'] as IStorageDriver | undefined)
    ?? new DurableNodeStorageDriver();
  const descriptors = createUnifiedHistoryDescriptors({
    driver,
    resolveJournal: options?.recordMutations !== false,
    deferStart: true,
    ...(options?.inMemory === true ? { inMemory: true } : {}),
    ...(options?.dbPath === undefined ? {} : { dbPath: options.dbPath }),
  });

  context.shared[HISTORY_SLOT] = descriptors;

  return descriptors;
}

/** Session participant (`brud.core.universalHistory`). */
export function createHistorySessionService(context: KernelServiceModuleContext) {
  return historyDescriptorsFor(context).session;
}

/** Journal participant (`brud.core.history`). */
export function createHistoryJournalService(context: KernelServiceModuleContext) {
  return historyDescriptorsFor(context).journal;
}

/** Default export: the session participant. */
export function createService(context: KernelServiceModuleContext) {
  return createHistorySessionService(context);
}
