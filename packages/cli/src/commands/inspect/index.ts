import { flagText, type ParsedArgs } from '../../core/args.js';
import { analyzeComposition } from '../../composition/analyze.js';
import { asHost, parseOptions, resolveConfigPath, viewKernel, withScratchKernel, type KernelPackage } from '../../composition/load.js';
import { CommandError } from '../../core/errors.js';
import type { Io } from '../../core/io.js';
import { loadPackage } from '../../core/project.js';
import { hasFailure, printData, printFindings, type Style } from '../../core/report.js';

export const INSPECT_FLAGS = { repeat: ['option', 'cap'], value: ['config'] } as const;

interface ExposureReport {
  readonly name: string;
  readonly capabilities: readonly string[];
  /** Whether a host holding these capabilities resolves it. */
  readonly resolves: { readonly none: boolean; readonly policy: boolean; readonly given?: boolean };
}

const yes = (value: boolean): string => (value ? 'yes' : 'no');

/**
 * `brud inspect [config]` and `brud kinds [config]`: what the composition
 * contains and who can reach it, from the kernel's public surface and the
 * package data files. `--cap <capability>` (repeatable) adds a probe: does a
 * host holding exactly those capabilities resolve each exposure?
 */
export async function runInspect(io: Io, style: Style, args: ParsedArgs, only: 'all' | 'kinds'): Promise<number> {
  const configPath = resolveConfigPath(io.cwd, args.positionals[0] ?? flagText(args, 'config'));
  const options = parseOptions(args.lists.get('option') ?? []);
  const given = args.lists.get('cap');
  const kernel = (await loadPackage('@brud/kernel', io.cwd).catch(() => {
    throw new CommandError('PACKAGE_NOT_FOUND', '@brud/kernel is not installed here. Run `npm install @brud/kernel @brud/sdk` in your project.');
  })) as KernelPackage;
  const analysis = await analyzeComposition(kernel, configPath, options);

  if (hasFailure(analysis.findings) || analysis.view === undefined) {
    printFindings(io, style, analysis.findings, { config: configPath });

    return 1;
  }

  const packages = analysis.entries.filter((entry) => entry.kind === 'package');
  const exposures = await withScratchKernel(kernel, configPath, options, async (booted) => {
    const reports = new Map<string, ExposureReport[]>();

    for (const entry of packages) {
      const list: ExposureReport[] = [];

      for (const exposure of entry.exposureDetails) {
        const probe = (capabilities: readonly string[]): Promise<boolean> => asHost(kernel, booted, capabilities, (registry) => registry.resolve(exposure.name) !== null);

        list.push({ name: exposure.name, capabilities: exposure.capabilities, resolves: { none: await probe([]), policy: await probe(exposure.capabilities), ...(given === undefined ? {} : { given: await probe(given) }) } });
      }

      reports.set(entry.path, list);
    }

    return { reports, view: await viewKernel(kernel, booted) };
  });
  const data = {
    config: configPath,
    participants: exposures.view.services,
    kinds: exposures.view.kinds,
    ...(only === 'kinds' ? {} : { packages: packages.map((entry) => ({ id: entry.id, path: entry.path, official: entry.official === true, requires: entry.requiresOfficial ? { official: true, powers: entry.powers } : null, exposures: exposures.reports.get(entry.path) ?? [] })) }),
  };

  printData(io, style, data, () => {
    const lines: string[] = [];

    if (only === 'all') {
      lines.push('Participants:', ...data.participants.map((service) => `  ${service.id}  (${service.tier})`), '');
    }

    lines.push('Kinds:');

    if (data.kinds.length === 0) {
      lines.push('  (none)');
    }

    for (const kind of data.kinds) {
      const operations = kind.operations !== null && typeof kind.operations === 'object' ? Object.keys(kind.operations).join(', ') : '';

      lines.push(`  ${kind.kind}${kind.description === undefined ? '' : ` - ${kind.description}`}${operations === '' ? '' : `  [${operations}]`}`);
    }

    if (only === 'all') {
      for (const pkg of data.packages ?? []) {
        lines.push('', `Package ${pkg.id ?? pkg.path} (${pkg.official ? 'official' : 'not official'})${pkg.requires === null ? '' : `, requires official; powers: ${pkg.requires.powers.join(', ') || 'none declared'}`}`);

        for (const exposure of pkg.exposures) {
          const need = exposure.capabilities.length === 0 ? 'no capabilities' : exposure.capabilities.join(', ');

          lines.push(`  ${exposure.name}  needs: ${need}  resolves: none=${yes(exposure.resolves.none)} policy=${yes(exposure.resolves.policy)}${exposure.resolves.given === undefined ? '' : ` given=${yes(exposure.resolves.given)}`}`);
        }
      }

      lines.push('', 'Native participants\' exposures are not listed by the kernel; their kinds appear above.');
    }

    return `${lines.join('\n')}\n`;
  });

  return 0;
}
