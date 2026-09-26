import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'node:os';

export async function createTestWorkspace(prefix: string = 'brud-test-'): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function cleanupTestWorkspace(dirPath: string): Promise<void> {
  await fs.rm(dirPath, { recursive: true, force: true });
}