import type { IStorageDriver } from '../../../../drivers/contracts/index.js';

export async function readFile(
  driver: IStorageDriver,
  absolutePath: string,
): Promise<Uint8Array> {
  return driver.readFile(absolutePath);
}

export async function readText(
  driver: IStorageDriver,
  absolutePath: string,
  encoding?: BufferEncoding,
): Promise<string> {
  return driver.readText(absolutePath, encoding);
}
