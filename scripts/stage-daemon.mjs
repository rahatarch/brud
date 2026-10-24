import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = join(repositoryRoot, 'packages', 'daemon', 'dist');
const destinationDirectory = join(repositoryRoot, 'dist', 'daemon');

try {
  await rm(destinationDirectory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
  await mkdir(dirname(destinationDirectory), { recursive: true });
  await cp(sourceDirectory, destinationDirectory, { recursive: true });

  await build({
    entryPoints: [join(sourceDirectory, 'cli.js')],
    outfile: join(destinationDirectory, 'cli.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    logLevel: 'silent',
  });
  await rm(join(destinationDirectory, 'cli.js.map'), { force: true });

  process.stdout.write(`Staged daemon CLI bundle at ${destinationDirectory}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Failed to stage daemon CLI bundle: ${message}\n`);
  process.exitCode = 1;
}
