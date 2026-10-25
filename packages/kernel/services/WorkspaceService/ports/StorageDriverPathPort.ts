import type { IStorageDriver } from '../../../drivers/contracts/index.js';
import type { IWorkspacePathPort } from '../contracts/IWorkspaceService.js';

/**
 * Adapts a storage driver to the narrow filesystem surface the workspace
 * authority needs.
 *
 * Keeping the port at two methods means the workspace service cannot read or
 * write workspace content, and tests can substitute a tiny fake instead of a
 * full storage driver.
 *
 * @param driver - Storage driver backing the kernel.
 * @returns A `realpath`/`lstat` port over the driver.
 */
export function createStorageDriverPathPort(driver: IStorageDriver): IWorkspacePathPort {
  return {
    lstat: (absolutePath: string) => driver.lstat(absolutePath),
    realpath: (absolutePath: string) => driver.realpath(absolutePath),
  };
}
