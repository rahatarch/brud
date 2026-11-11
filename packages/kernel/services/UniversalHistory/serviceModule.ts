import type { IStorageDriver } from '../../drivers/contracts/index.js';
import type { KernelServiceModuleContext } from '../../src/bootstrap/bootTypes.js';
import type { MutationJournalPort } from '../../src/contracts/mutationJournal.js';
import type { IFileMutationJournal } from '../BrudFileSystem/events/types.js';
import {
  HISTORY_CONTEXT_SCOPE,
  HISTORY_ROOT_CONTEXT_FIELD,
  MissingHistoryMutationJournalError,
  MissingHistoryStorageDriverError,
} from './bootOptions.js';
import { createUnifiedHistoryDescriptors } from './unified/descriptor/unifiedHistoryDescriptors.js';

/** History storage overrides read from the generic options bag. */
interface HistoryOptions {
  readonly inMemory?: boolean;
  readonly dbPath?: string;
}

type HistoryDescriptors = ReturnType<typeof createUnifiedHistoryDescriptors>;

const HISTORY_SLOT = 'brud.core.history.descriptors';
const HISTORY_CONTRACT_SLOT = 'brud.core.history.contract';

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

  const storageDriver = context.options['storageDriver'] as IStorageDriver | undefined;

  if (storageDriver === undefined) {
    throw new MissingHistoryStorageDriverError();
  }

  const mutationJournal = context.options['mutationJournal'] as
    | MutationJournalPort
    | undefined;

  if (mutationJournal === undefined) {
    throw new MissingHistoryMutationJournalError();
  }

  const options = context.options['history'] as HistoryOptions | undefined;
  const descriptors = createUnifiedHistoryDescriptors({
    driver: storageDriver,
    journal: mutationJournal as unknown as IFileMutationJournal,
    ...(options?.inMemory === true ? { inMemory: true } : {}),
    ...(options?.dbPath === undefined ? {} : { dbPath: options.dbPath }),
  });

  context.shared[HISTORY_SLOT] = descriptors;

  return descriptors;
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
