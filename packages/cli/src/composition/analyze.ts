import { existsSync } from 'node:fs';
import {
  bootFailure,
  hardcoreModulePaths,
  readComposition,
  viewKernel,
  withScratchKernel,
  type EntryInfo,
  type KernelPackage,
  type KernelView,
} from './load.js';
import type { Finding } from '../core/report.js';

/** What the analysis of one composition produced. */
export interface Analysis {
  readonly findings: readonly Finding[];
  readonly entries: readonly EntryInfo[];
  /** Present only when the composition booted. */
  readonly view: KernelView | undefined;
}

const line = (path: string): string => `{ "path": "${path}", "official": true }`;

/** Checks that need no running code: the composition's shape, officialness and capabilities. */
export function staticFindings(kernel: KernelPackage, entries: readonly EntryInfo[], configPath: string): Finding[] {
  const findings: Finding[] = [];
  const expected = hardcoreModulePaths(kernel.root);
  const missing = expected.filter((path) => !entries.some((entry) => entry.path === path));
  const unofficial = expected.filter((path) => entries.some((entry) => entry.path === path && entry.official !== true));

  findings.push(missing.length > 0
    ? { id: 'composition.hardcores', title: 'Every hardcore service is in the composition', status: 'fail', cause: `missing ${missing.join(', ')}`, fix: `In ${configPath}, add ${line('kernel:serviceModules/<name>.js')} for each missing name (${missing.map((path) => path.replace('kernel:serviceModules/', '').replace('.js', '')).join(', ')}).` }
    : unofficial.length > 0
      ? { id: 'composition.hardcores', title: 'Every hardcore service is official', status: 'fail', cause: `not official: ${unofficial.join(', ')}`, fix: 'Set "official": true on each hardcore entry; their trust is not the owner\'s to remove.' }
      : { id: 'composition.hardcores', title: 'Every hardcore service is in the composition and official', status: 'pass' });

  const others = entries.filter((entry) => entry.kind !== 'kernel-module');

  for (const entry of others) {
    const name = entry.id ?? entry.path;

    if (entry.kind === 'native' && entry.official !== true) {
      findings.push({ id: 'entry.tier', title: `Entry ${name} is allowed to run`, status: 'fail', cause: 'a native module that is not declared official is refused (PARTICIPANT_TIER)', fix: `Add "official": true to its entry if you trust it, or package it for the cage with \`brud pack\`.` });
    } else if (entry.kind === 'package' && entry.requiresOfficial) {
      const powers = entry.powers.length === 0 ? 'no declared powers' : `powers: ${entry.powers.join(', ')}`;

      findings.push(entry.official === true
        ? { id: 'entry.requires', title: `Entry ${name} requires official (${powers}) and the composition grants it`, status: 'info' }
        : { id: 'entry.requires', title: `Entry ${name} requires official (${powers})`, status: 'fail', cause: 'the package refuses to boot unless the owner declares it official (PARTICIPANT_REQUIRES_OFFICIAL)', fix: `If you trust it, add "official": true to its entry: ${line(entry.path)}. Otherwise remove the entry.` });
    }
  }

  const granted = new Set(others.flatMap((entry) => entry.policyCapabilities));
  const hasNative = others.some((entry) => entry.kind === 'native');
  const ungrantable = others.flatMap((entry) => entry.requestedCapabilities.filter((capability) => !granted.has(capability)).map((capability) => `${entry.id ?? entry.path} requests ${capability}`));

  if (ungrantable.length > 0) {
    // With native participants present their policies are invisible without running them, so the
    // question cannot be answered statically; say so without raising a warning.
    findings.push(hasNative
      ? { id: 'capabilities.ungrantable', title: 'Requested capabilities that no package policy asks for (native participants may grant them)', status: 'info', cause: ungrantable.join('; ') }
      : { id: 'capabilities.ungrantable', title: 'Every requested capability is one some exposure policy asks for', status: 'warn', cause: ungrantable.join('; '), fix: 'Check the capability spelling, or add a participant whose exposure policy lists it.' });
  }

  return findings;
}

/**
 * The composition checks shared by `doctor`, `check` and `inspect`: static
 * findings, then a boot in a scratch state when the static ones allow it.
 */
export async function analyzeComposition(kernel: KernelPackage, configPath: string, options: Readonly<Record<string, unknown>>): Promise<Analysis> {
  if (!existsSync(configPath)) {
    return { findings: [{ id: 'composition.parse', title: 'The composition parses', status: 'fail', cause: `no composition at ${configPath}`, fix: 'Run `brud init`, or pass the path to a brud.config.json.' }], entries: [], view: undefined };
  }

  let entries: readonly EntryInfo[];

  try {
    entries = readComposition(kernel, configPath).entries;
  } catch (error: unknown) {
    return { findings: [bootFailure('composition.parse', 'The composition parses', error)], entries: [], view: undefined };
  }

  const findings: Finding[] = [{ id: 'composition.parse', title: `The composition parses (${String(entries.length)} entries)`, status: 'pass' }, ...staticFindings(kernel, entries, configPath)];

  if (findings.some((finding) => finding.status === 'fail')) {
    findings.push({ id: 'composition.boot', title: 'The composition boots', status: 'info', cause: 'not tried: fix the problems above first' });

    return { findings, entries, view: undefined };
  }

  try {
    const { view, left } = await withScratchKernel(kernel, configPath, options, async (booted) => ({
      view: await viewKernel(kernel, booted),
      left: (booted as { abandoned?: readonly { path: string; reason: string }[] }).abandoned ?? [],
    }));

    findings.push({ id: 'composition.boot', title: `The composition boots in a scratch state (${String(view.services.length)} services, ${String(view.kinds.length)} kinds)`, status: 'pass' });

    // The kernel starts without a participant it cannot load, so a boot that passes can still hide one.
    for (const entry of left) {
      findings.push({
        id: 'composition.left-out',
        title: `Entry ${entry.path} was left out of the boot`,
        status: 'fail',
        cause: entry.reason,
        fix: 'Fix the cause above, or remove the entry. The kernel starts without it, so the product would run without this participant.',
      });
    }

    return { findings, entries, view };
  } catch (error: unknown) {
    findings.push(bootFailure('composition.boot', 'The composition boots', error));

    return { findings, entries, view: undefined };
  }
}
