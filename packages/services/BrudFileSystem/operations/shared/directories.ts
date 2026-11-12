import { dirname } from 'node:path';
import type { IStorageDriver } from '@brud/kernel';

export async function ensureParentDirectory(
  driver: IStorageDriver,
  absolutePath: string,
): Promise<void> {
  await driver.mkdir(dirname(absolutePath), { recursive: true });
}
