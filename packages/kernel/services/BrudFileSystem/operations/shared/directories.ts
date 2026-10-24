import { dirname } from 'node:path';
import type { IStorageDriver } from '../../../../drivers/contracts/index.js';

export async function ensureParentDirectory(
  driver: IStorageDriver,
  absolutePath: string,
): Promise<void> {
  await driver.mkdir(dirname(absolutePath), { recursive: true });
}
