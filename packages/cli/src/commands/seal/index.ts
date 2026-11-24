import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { flagText, type ParsedArgs } from '../../core/args.js';
import { CommandError } from '../../core/errors.js';
import type { Io } from '../../core/io.js';
import { loadPackage } from '../../core/project.js';
import { printData, type Style } from '../../core/report.js';

export const SEAL_FLAGS = { boolean: [], value: ['out'] } as const;

interface SealingKernel {
  createSeal(configPath: string): { readonly text: string; readonly digest: string };
}

/**
 * `brud seal [config]`: generates the build seal for a composition.
 *
 * A builder runs it once per release, after the build is final. The seal lists
 * every composed participant in the build with its content hash and declared
 * trust status. The command prints the seal's digest, which the built product
 * passes to the kernel at boot together with the seal file. Anything added
 * later at runtime or in user config is a loaded participant.
 */
export async function runSeal(io: Io, style: Style, args: ParsedArgs): Promise<number> {
  const configPath = resolve(io.cwd, args.positionals[0] ?? 'brud.config.json');
  const kernel = await loadPackage<SealingKernel>('@brud/kernel', dirname(configPath)).catch(() => {
    throw new CommandError('PACKAGE_NOT_FOUND', '@brud/kernel is not installed here, so the seal cannot be generated.');
  });

  if (typeof kernel.module.createSeal !== 'function') {
    throw new CommandError('PACKAGE_NOT_FOUND', 'The installed @brud/kernel is too old to generate a build seal.');
  }

  const created = kernel.module.createSeal(configPath);
  const out = resolve(io.cwd, flagText(args, 'out') ?? join(dirname(configPath), 'brud.seal.json'));

  writeFileSync(out, created.text, 'utf8');

  printData(io, style, { config: configPath, seal: out, digest: created.digest }, () => `Wrote ${out}\nDigest: ${created.digest}\n\nPass the seal to the kernel in the built product, with this digest:\n  bootKernel(config, { seal: { path: '<the seal file>', digest: '${created.digest}' } })\nKeep the digest in the product, not next to the config.\n`);

  return 0;
}
