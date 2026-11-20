import type { IStorageDriver } from './contracts/index.js';
import type { KernelServiceModuleContext } from '@brud/kernel';
import type { WorkspaceDescriptorOptions } from '../WorkspaceService/descriptor/descriptor.js';
import {
  FILESYSTEM_CONTEXT_SCOPE,
  FILESYSTEM_ROOT_CONTEXT_FIELD,
  createFileSystemDescriptor,
} from './descriptor/descriptor.js';
import { DurableNodeStorageDriver } from './drivers/DurableNodeStorageDriver.js';
import { createFileMutationJournal } from './events/FileMutationJournal.js';

/**
 * The one caller the filesystem currently grants its mutation journal to.
 *
 * This is the giver's policy, held by the filesystem service. It names a
 * caller id, not a kernel type; the kernel never reads it.
 */

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
    resolveGivers: true,
  });

  return fileSystemDescriptor;
}
