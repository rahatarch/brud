import { flagText, type ParsedArgs } from '../args.js';
import { analyzeComposition } from '../analyze.js';
import { parseOptions, resolveConfigPath } from '../composition.js';
import { CommandError } from '../errors.js';
import type { Io } from '../io.js';
import { loadPackage } from '../project.js';
import { hasFailure, printFindings, type Style } from '../report.js';
import type { KernelPackage } from '../composition.js';

export const CHECK_FLAGS = { repeat: ['option'] } as const;

/**
 * `brud check [config]`: boots the composition in a scratch state and reports
 * every problem with its cause and fix. Exit 1 on any failure.
 */
export async function runCheck(io: Io, style: Style, args: ParsedArgs): Promise<number> {
  const configPath = resolveConfigPath(io.cwd, args.positionals[0] ?? flagText(args, 'config'));
  let kernel: KernelPackage;

  try {
    kernel = await loadPackage('@brud/kernel', io.cwd);
  } catch {
    throw new CommandError('PACKAGE_NOT_FOUND', '@brud/kernel is not installed here. Run `npm install @brud/kernel @brud/sdk` in your project.');
  }

  const analysis = await analyzeComposition(kernel, configPath, parseOptions(args.lists.get('option') ?? []));

  printFindings(io, style, analysis.findings, { config: configPath, kernel: kernel.version });

  return hasFailure(analysis.findings) ? 1 : 0;
}
