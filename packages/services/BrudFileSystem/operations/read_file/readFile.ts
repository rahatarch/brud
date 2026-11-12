import type { IStorageDriver } from '@brud/kernel';

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
