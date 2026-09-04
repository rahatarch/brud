import * as fs from 'fs/promises';
import * as path from 'path';

export async function createTestWorkspace(prefix: string = 'brud-test-'): Promise<string> {
  return fs.mkdtemp(path.join('/tmp', prefix));
}

export async function cleanupTestWorkspace(dirPath: string): Promise<void> {
  await fs.rm(dirPath, { recursive: true, force: true });
}