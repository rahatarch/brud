import type { IStorageDriver } from '../../drivers/contracts/index.js';
import type { KernelServiceModuleContext } from '../../src/bootstrap/bootTypes.js';
import type { IValidationService } from '../ValidationService/contracts/IValidationService.js';
import type { WorkspaceDescriptorOptions } from '../WorkspaceService/descriptor/descriptor.js';
import type { IWorkspaceService } from '../WorkspaceService/contracts/IWorkspaceService.js';
import { createFileSystemDescriptor } from './descriptor/descriptor.js';
import { DurableNodeStorageDriver } from './drivers/DurableNodeStorageDriver.js';
import { createFileMutationJournal } from './events/FileMutationJournal.js';
import type { IFileMutationJournal } from './events/types.js';

export function createService(context: KernelServiceModuleContext) {
  const options = context.options;
  const workspaceOptions = options['workspace'] as
    | WorkspaceDescriptorOptions
    | undefined;
  const driver = workspaceOptions?.driver
    ?? (options['storageDriver'] as IStorageDriver | undefined)
    ?? new DurableNodeStorageDriver();
  const mutationJournal = (options['mutationJournal'] as IFileMutationJournal | undefined)
    ?? createFileMutationJournal();

  options['storageDriver'] = driver;
  options['mutationJournal'] = mutationJournal;

  return createFileSystemDescriptor({
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
}