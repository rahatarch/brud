import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type * as Kernel from '@brud/kernel';
import { describeError } from './errors.js';
import type { Finding } from './report.js';
import type { LoadedPackage } from './project.js';

export type KernelPackage = LoadedPackage<typeof Kernel>;

/** The default composition file name. */
export const CONFIG_FILE = 'brud.config.json';

/** The hardcore modules the installed kernel ships, as composition paths, read from the kernel itself. */
export function hardcoreModulePaths(kernelRoot: string): readonly string[] {
  const directory = join(kernelRoot, 'dist', 'serviceModules');

  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory)
    .filter((name) => name.endsWith('.js'))
    .sort()
    .map((name) => `kernel:serviceModules/${name}`);
}

/** Where the composition is: `--config`/positional, else `brud.config.json` in `cwd`. */
export function resolveConfigPath(cwd: string, explicit: string | undefined): string {
  return explicit === undefined ? join(cwd, CONFIG_FILE) : resolve(cwd, explicit);
}

/** How a composition entry is declared. */
export type EntryKind = 'kernel-module' | 'package' | 'native';

/** One composition entry with what can be read without running it. */
export interface EntryInfo {
  readonly path: string;
  readonly official: boolean | undefined;
  readonly kind: EntryKind;
  /** Absolute path of a package's data file, when it is a package entry. */
  readonly manifestPath: string | undefined;
  readonly id: string | undefined;
  readonly requiresOfficial: boolean;
  readonly powers: readonly string[];
  readonly requestedCapabilities: readonly string[];
  readonly policyCapabilities: readonly string[];
  readonly exposures: readonly string[];
  /** Each declared exposure with the capabilities its policy asks for. */
  readonly exposureDetails: readonly { readonly name: string; readonly capabilities: readonly string[] }[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

function classify(entry: Kernel.BrudConfigEntry, configDir: string): EntryInfo {
  const base = { path: entry.path, official: entry.official } as const;
  const empty = { id: undefined, requiresOfficial: false, powers: [], requestedCapabilities: [], policyCapabilities: [], exposures: [], exposureDetails: [] } as const;

  if (entry.path.startsWith('kernel:')) {
    return { ...base, kind: 'kernel-module', manifestPath: undefined, ...empty };
  }

  if (!entry.path.endsWith('brud.participant.json')) {
    return { ...base, kind: 'native', manifestPath: undefined, ...empty };
  }

  const manifestPath = isAbsolute(entry.path) ? entry.path : resolve(configDir, entry.path);

  try {
    const data = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
    const manifest = isRecord(data) && isRecord(data.manifest) ? data.manifest : {};
    const exposures = Array.isArray(manifest.exposures) ? manifest.exposures.filter(isRecord) : [];
    const requires = isRecord(data) && isRecord(data.requires) ? data.requires : undefined;
    const requests = isRecord(manifest.requests) ? manifest.requests : {};

    return {
      ...base,
      kind: 'package',
      manifestPath,
      id: isRecord(data) && typeof data.id === 'string' ? data.id : undefined,
      requiresOfficial: requires?.official === true,
      powers: strings(requires?.powers),
      requestedCapabilities: strings(requests.capabilities),
      policyCapabilities: exposures.flatMap((exposure) => (isRecord(exposure.policy) ? strings(exposure.policy.capabilities) : [])),
      exposures: exposures.flatMap((exposure) => (typeof exposure.name === 'string' ? [exposure.name] : [])),
      exposureDetails: exposures.flatMap((exposure) => (typeof exposure.name === 'string' ? [{ name: exposure.name, capabilities: isRecord(exposure.policy) ? strings(exposure.policy.capabilities) : [] }] : [])),
    };
  } catch {
    // An unreadable data file is reported by the kernel at boot (MODULE_RESOLVE).
    return { ...base, kind: 'package', manifestPath, ...empty };
  }
}

/** Reads and parses a composition with the kernel's own parser. */
export function readComposition(kernel: KernelPackage, configPath: string): { readonly config: Kernel.BrudConfig; readonly entries: readonly EntryInfo[] } {
  let raw: string;

  try {
    raw = readFileSync(configPath, 'utf8');
  } catch (error: unknown) {
    throw new kernel.module.BrudConfigError('CONFIG_READ', `cannot read ${configPath} (${describeError(error).message})`, configPath);
  }

  const config = kernel.module.parseBrudConfig(raw, configPath);

  return { config, entries: config.services.map((entry) => classify(entry, dirname(configPath))) };
}

/** Fix hints for kernel config failures, by code. */
const FIX_FOR_CODE: Readonly<Record<string, string>> = {
  CONFIG_READ: 'Check the composition path, or run `brud init` to create a project.',
  CONFIG_PARSE: 'Fix the JSON syntax at the reported line.',
  CONFIG_SCHEMA: 'The composition needs a "services" array of { "path", "official"? } entries.',
  CONFIG_INTEGRITY: 'The composition changed from what was pinned; restore it or re-pin deliberately.',
  MODULE_RESOLVE: 'Make the entry path resolve (relative to the composition file) and, for packages, match its sha256.',
  MODULE_CONTRACT: 'The module must export createService returning a service descriptor (see defineParticipant).',
  PARTICIPANT_TIER: 'A native module runs only when declared official. Add "official": true, or package it for the cage with `brud pack`.',
  PARTICIPANT_REQUIRES_OFFICIAL: 'The package refuses to run unless you declare its entry official. Add "official": true only if you trust it.',
  EXPOSED_API_NAME_COLLISION: 'Two participants declare the same exposure name. Rename one, or pin the intended owner under "exposureOwners" in the composition.',
  EXPOSED_API_OWNER_PIN: 'An exposure is pinned to a different owner. Fix the "exposureOwners" entry or the participant that declares the name.',
  EXPOSED_API_INVALID_NAME: 'Exposure names are dotted lower-case (for example acme.tasks.read).',
  MANIFEST_INVALID: 'The participant\'s manifest is malformed; compare it with the manifest keys in the docs reference.',
  HARDCORE_VERIFICATION: 'A hardcore service failed verification: reinstall @brud/kernel and keep every hardcore entry in the composition.',
};

/** Turns anything a boot threw into a failed finding that names the cause and the fix. */
export function bootFailure(id: string, title: string, error: unknown): Finding {
  const { code, message } = describeError(error);

  return {
    id,
    title,
    status: 'fail',
    cause: `${code === undefined ? '' : `${code}: `}${message}`.replace(/\s+/gu, ' ').slice(0, 400),
    fix: code === undefined ? 'Read the cause above; run with --json for the full text.' : (FIX_FOR_CODE[code] ?? 'Read the cause above.'),
  };
}

/** Parses `key=value` boot options; a value is JSON when it parses, text otherwise. */
export function parseOptions(pairs: readonly string[]): Readonly<Record<string, unknown>> {
  const options: Record<string, unknown> = {};

  for (const pair of pairs) {
    const at = pair.indexOf('=');

    if (at < 1) {
      throw new Error(`--option expects key=value, got "${pair}"`);
    }

    const value = pair.slice(at + 1);

    try {
      options[pair.slice(0, at)] = JSON.parse(value) as unknown;
    } catch {
      options[pair.slice(0, at)] = value;
    }
  }

  return options;
}

/**
 * Boots the composition with its state in `stateDir` (the identity registry and
 * the router root), the way a product would.
 */
export async function bootIn(kernel: KernelPackage, configPath: string, stateDir: string, options: Readonly<Record<string, unknown>>): Promise<Kernel.BrudKernel> {
  const identityPath = join(stateDir, 'identity.json');

  // A state folder keeps its identity registry between runs; provisioning never overwrites one.
  if (!existsSync(identityPath)) {
    kernel.module.provisionIdentityRegistryStorage(identityPath);
  }

  return kernel.module.bootKernel(configPath, {
    options: { 'identity.registry.path': identityPath, 'router.root': stateDir, ...options },
  });
}

/** Boots in a throw-away state folder, runs `use`, then shuts down and removes the folder. */
export async function withScratchKernel<T>(kernel: KernelPackage, configPath: string, options: Readonly<Record<string, unknown>>, use: (booted: Kernel.BrudKernel) => Promise<T>): Promise<T> {
  const scratch = await mkdtemp(join(tmpdir(), 'brud-cli-'));
  let booted: Kernel.BrudKernel | undefined;

  try {
    booted = await bootIn(kernel, configPath, scratch, options);

    return await use(booted);
  } finally {
    if (booted?.lifecycleState === 'RUNNING') {
      await booted.shutdown();
    }

    await rm(scratch, { recursive: true, force: true });
  }
}

/** What a running kernel says about itself through its public surface. */
export interface KernelView {
  readonly services: readonly { readonly id: string; readonly tier: string; readonly initialized: boolean }[];
  readonly kinds: readonly { readonly kind: string; readonly description?: string; readonly operations?: unknown }[];
}

interface SyntaxRoute {
  kinds(): readonly KernelView['kinds'][number][];
  route(text: string): Promise<unknown>;
}

/** Runs `use` as a host caller holding `capabilities`, with the router's public handle. */
export async function asHost<T>(kernel: KernelPackage, booted: Kernel.BrudKernel, capabilities: readonly string[], use: (registry: Kernel.IExposedApiRegistry, syntax: SyntaxRoute | null) => Promise<T> | T): Promise<T> {
  return booted.runHostCall({ capabilities: [...capabilities] }, async () => {
    const registry = booted.requestAccess({ callerId: 'brud.cli', tier: 'core', options: {} }, kernel.module.ExposedApiRegistryToken) as Kernel.IExposedApiRegistry;

    return use(registry, registry.resolve<SyntaxRoute>('syntax.route'));
  });
}

/** Lists the participants and kinds of a booted kernel. */
export async function viewKernel(kernel: KernelPackage, booted: Kernel.BrudKernel): Promise<KernelView> {
  const kinds = await asHost(kernel, booted, [], (_registry, syntax) => (syntax === null ? [] : [...syntax.kinds()]));

  return {
    services: booted.listServices().map((service) => ({ id: service.id, tier: String(service.tier), initialized: service.initialized })),
    kinds: JSON.parse(JSON.stringify(kinds)) as KernelView['kinds'],
  };
}
