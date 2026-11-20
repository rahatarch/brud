import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseOperatorConfig } from '../../operatorConfig.js';
import type { DaemonOperatorConfig } from '../../operatorConfig.js';

/** The kernel's hardcore services, from the kernel package only. */
export const HARDCORES = ['identityRegistry', 'exposedApiRegistry', 'parser', 'router', 'wasmCage', 'events', 'interception']
  .map((name) => ({ path: `kernel:serviceModules/${name}.js`, official: true }));

/** Absolute path of the throwaway probe participant. */
export const PROBE_PARTICIPANT = resolve(__dirname, 'probeParticipant.ts');

export interface ProbeHome {
  /** Daemon home (temporary). */
  readonly home: string;
  readonly composition: string;
  readonly operator: DaemonOperatorConfig;
  readonly cleanup: () => Promise<void>;
}

export interface ProbeHomeOptions {
  readonly prefix?: string;
  readonly clientOptions?: readonly string[];
  readonly fixedOptions?: Readonly<Record<string, unknown>>;
  readonly principals?: { readonly ui?: readonly string[]; readonly ai?: readonly string[] };
  readonly reuseIdenticalBoots?: boolean;
  /** Leave the probe out of the composition (hardcores only). */
  readonly withoutProbe?: boolean;
}

/**
 * A temporary daemon home with its own composition (kernel hardcores plus the
 * probe participant) and operator config (`daemon.json`).
 */
export async function createProbeHome(options: ProbeHomeOptions = {}): Promise<ProbeHome> {
  const home = await realpath(await mkdtemp(join(tmpdir(), options.prefix ?? 'brud-daemon-home-')));
  const composition = join(home, 'brud.config.json');
  const services = options.withoutProbe === true
    ? HARDCORES
    : [...HARDCORES, { path: PROBE_PARTICIPANT, official: true }];
  const operatorValue = {
    composition,
    clientOptions: options.clientOptions ?? ['probe.label'],
    fixedOptions: options.fixedOptions ?? {},
    principals: { ui: options.principals?.ui ?? ['probe:ui'], ai: options.principals?.ai ?? ['probe:ai'] },
    reuseIdenticalBoots: options.reuseIdenticalBoots ?? false,
  };

  await writeFile(composition, JSON.stringify({ services }, null, 2), 'utf8');
  await writeFile(join(home, 'daemon.json'), JSON.stringify(operatorValue, null, 2), 'utf8');

  return {
    home,
    composition,
    operator: parseOperatorConfig(operatorValue, join(home, 'daemon.json')),
    cleanup: () => rm(home, { recursive: true, force: true }),
  };
}

/** Brud syntax for one probe call. */
export function probeCall(name: string, body = 'x: 1'): string {
  return `[BRUD]\n[CALL probe ${name}]\n${body}\n[END]\n[/BRUD]`;
}
