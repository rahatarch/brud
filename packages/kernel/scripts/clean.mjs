// Removes the kernel's build output so every build starts from nothing.
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

rmSync(join(root, 'dist'), { recursive: true, force: true });
rmSync(join(root, 'tsconfig.tsbuildinfo'), { force: true });
