import * as os from 'os';
import * as path from 'path';
import { VSCodeFileSystem } from './filesystem';

const BRUD_DIR = '.brud';
const PROMPTS_DIR = 'prompts';

export function getBrudHomeDir(): string {
  return path.join(os.homedir(), BRUD_DIR);
}

export function getGlobalPromptsDir(): string {
  return path.join(getBrudHomeDir(), PROMPTS_DIR);
}

export async function ensureBrudHomeDir(fs: VSCodeFileSystem): Promise<void> {
  const home = getBrudHomeDir();
  if (!(await fs.exists(home))) {
    await fs.createDirectory(home);
  }
  const prompts = getGlobalPromptsDir();
  if (!(await fs.exists(prompts))) {
    await fs.createDirectory(prompts);
  }
}