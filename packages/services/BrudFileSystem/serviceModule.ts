import type { IStorageDriver } from './contracts/index.js';
import type { KernelServiceModuleContext } from '@brud/kernel';
import type { ServiceDescriptor } from '@brud/kernel';
import type { IValidationService } from '../ValidationService/contracts/IValidationService.js';
import type { WorkspaceDescriptorOptions } from '../WorkspaceService/descriptor/descriptor.js';
import type { IWorkspaceService } from '../WorkspaceService/contracts/IWorkspaceService.js';
import {
  FILESYSTEM_CONTEXT_SCOPE,
  FILESYSTEM_ROOT_CONTEXT_FIELD,
  createFileSystemDescriptor,
} from './descriptor/descriptor.js';
import { FileMutationJournalToken } from './descriptor/journalTokens.js';
import { DurableNodeStorageDriver } from './drivers/DurableNodeStorageDriver.js';
import { createFileMutationJournal } from './events/FileMutationJournal.js';
import type { IFileMutationJournalApi } from './events/types.js';

/**
 * The one caller the filesystem currently grants its mutation journal to.
 *
 * This is the giver's policy, held by the filesystem service. It names a
 * caller id, not a kernel type; the kernel never reads it.
 */
const MUTATION_JOURNAL_CALLER_ID = 'brud.core.universalHistory';

export function createService(context: KernelServiceModuleContext) {
  context.declareContextFields(FILESYSTEM_CONTEXT_SCOPE, [
    {
      name: FILESYSTEM_ROOT_CONTEXT_FIELD,
      type: 'string',
      required: true,
      description: 'Absolute workspace root used by the filesystem service.',
    },
  ]);

  const options = context.options;
  const workspaceOptions = options['workspace'] as
    | WorkspaceDescriptorOptions
    | undefined;
  const driver = workspaceOptions?.driver
    ?? (options['storageDriver'] as IStorageDriver | undefined)
    ?? new DurableNodeStorageDriver();
  const mutationJournal = createFileMutationJournal();

  const fileSystemDescriptor = createFileSystemDescriptor({
    driver,
    mutationJournal,
    workspace: () => {
      const instance = context.shared['brud.core.workspace.instance'] as
        | IWorkspaceService
        | undefined;

      if (instance === undefined) {
        throw new Error(
          'brud.core.workspace must be constructed before brud.core.filesystem',
        );
      }

      return instance;
    },
    validation: () => {
      const instance = context.shared['brud.core.validation.instance'] as
        | IValidationService
        | undefined;

      if (instance === undefined) {
        throw new Error(
          'brud.core.validation must be constructed before a filesystem policy check',
        );
      }

      return instance;
    },
  });

  // The journal is the filesystem's own concept. It is exposed as a separate
  // service API by the same module that owns it, so any permitted participant
  // resolves it through the broker under the filesystem's grant. No boot-bag
  // key carries it and the kernel never sees it.
  const mutationJournalDescriptor: ServiceDescriptor<IFileMutationJournalApi> = {
    token: FileMutationJournalToken,
    tier: 'core',
    dependencies: [],
    accessPolicy: { allowedCallers: [MUTATION_JOURNAL_CALLER_ID] },
    factory: (): IFileMutationJournalApi => ({ journal: mutationJournal, driver }),
  };

  return [fileSystemDescriptor, mutationJournalDescriptor];
}
