import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { bootFailure, hardcoreModulePaths, withScratchKernel, type EntryInfo, type KernelPackage } from '../../composition/load.js';
import { satisfies } from '../../core/project.js';
import type { Finding } from '../../core/report.js';
import type { Fetched, Inspected } from './types.js';

const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** A path inside the package folder, or undefined when it is not a string or escapes the folder. */
export function insidePackage(dir: string, path: unknown): string | undefined {
  if (typeof path !== 'string') {
    return undefined;
  }

  const full = resolve(dir, path);
  const rel = relative(dir, full);

  return rel.startsWith('..') || isAbsolute(rel) ? undefined : full;
}

const REFRESH = 'Ask the package author to fix and republish it.';

/** Checks `brud.participant.json`: present, valid JSON, and the fixed shape the kernel needs. */
function readDataFile(packageDir: string, fetched: Fetched, isValidName: (name: string) => boolean, findings: Finding[]): Record<string, unknown> | undefined {
  const path = join(packageDir, 'brud.participant.json');

  if (!existsSync(path)) {
    findings.push({ id: 'add.brud', title: `${fetched.name} is a Brud participant package`, status: 'fail', cause: 'it has no brud.participant.json, so it is an ordinary npm package', fix: `Install ordinary packages with \`npm install ${fetched.name}\`; \`brud add\` is for Brud participants.` });

    return undefined;
  }

  let data: unknown;

  try {
    data = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    findings.push({ id: 'add.brud', title: `${fetched.name} has a valid brud.participant.json`, status: 'fail', cause: 'the file is not valid JSON', fix: REFRESH });

    return undefined;
  }

  if (!isRecord(data) || data.format !== 1 || typeof data.id !== 'string' || !isValidName(data.id) || !isRecord(data.manifest) || !Array.isArray(data.manifest.exposures)) {
    findings.push({ id: 'add.brud', title: `${fetched.name} has a valid brud.participant.json`, status: 'fail', cause: 'it needs format 1, a dotted lower-case id, and a manifest with an "exposures" array', fix: REFRESH });

    return undefined;
  }

  findings.push({ id: 'add.brud', title: `${fetched.name} is a Brud participant package (id ${data.id})`, status: 'pass' });

  return data;
}

/** Checks the cage module and native entry the data file points at. */
function checkModules(packageDir: string, data: Record<string, unknown>, findings: Finding[]): { readonly caged: boolean; readonly native: boolean } {
  const cage = isRecord(data.cage) ? data.cage : undefined;
  const nativePath = data.native === undefined ? undefined : insidePackage(packageDir, data.native);

  if (cage === undefined && data.native === undefined) {
    findings.push({ id: 'add.kind', title: 'The package declares how it runs', status: 'fail', cause: 'it has neither a "cage" section (WebAssembly) nor a "native" entry', fix: REFRESH });
  }

  if (cage !== undefined) {
    const module = insidePackage(packageDir, cage.module);
    const digest = module !== undefined && existsSync(module) ? createHash('sha256').update(readFileSync(module)).digest('hex') : undefined;
    const title = 'The cage module is inside the package and matches its sha256';

    findings.push(digest !== undefined && digest === cage.sha256
      ? { id: 'add.cage', title, status: 'pass' }
      : { id: 'add.cage', title, status: 'fail', cause: digest === undefined ? 'cage.module is missing or points outside the package' : 'the module\'s sha256 differs from cage.sha256 (the kernel would refuse it)', fix: 'Do not use this package version; tell the author.' });
  }

  if (data.native !== undefined) {
    findings.push(nativePath !== undefined && existsSync(nativePath)
      ? { id: 'add.native', title: 'It ships a native entry, which runs only if you declare the entry official (it was not imported)', status: 'info' }
      : { id: 'add.native', title: 'The native entry is inside the package', status: 'fail', cause: 'native is missing or points outside the package', fix: 'Do not use this package version; tell the author.' });
  }

  return { caged: cage !== undefined, native: nativePath !== undefined };
}

/** npm install scripts and the kernel range the package supports, against the installed kernel. */
function checkManifest(packageDir: string, kernelVersion: string, allowScripts: boolean, findings: Finding[]): void {
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as { scripts?: Record<string, string>; peerDependencies?: Record<string, string>; dependencies?: Record<string, string> };
  const scripts = INSTALL_SCRIPTS.filter((name) => manifest.scripts?.[name] !== undefined);

  if (scripts.length > 0) {
    findings.push(allowScripts
      ? { id: 'add.scripts', title: `It has install scripts (${scripts.join(', ')}) and --allow-scripts was given, so they will run`, status: 'warn', fix: 'Read them before continuing.' }
      : { id: 'add.scripts', title: `It has install scripts (${scripts.join(', ')}); they will NOT run (installed with --ignore-scripts)`, status: 'warn', fix: 'If it truly needs them, review the scripts and re-run with --allow-scripts.' });
  }

  const range = manifest.peerDependencies?.['@brud/kernel'] ?? manifest.dependencies?.['@brud/kernel'];

  findings.push(range === undefined
    ? { id: 'add.compat', title: 'It declares which @brud/kernel versions it supports', status: 'warn', cause: 'no @brud/kernel range in its peerDependencies', fix: 'Compatibility with your kernel is unknown; run `brud check` after adding.' }
    : satisfies(kernelVersion, range)
      ? { id: 'add.compat', title: `Its @brud/kernel range ${range} includes your installed ${kernelVersion}`, status: 'pass' }
      : { id: 'add.compat', title: `Its @brud/kernel range ${range} includes your installed ${kernelVersion}`, status: 'fail', cause: `this package wants @brud/kernel ${range}`, fix: 'Use a version of the package that supports your kernel, or update the kernel.' });
}

/** Boots the package alone with the hardcore services, as a caged not-official participant. */
async function bootInScratch(kernel: KernelPackage, dataPath: string): Promise<Finding> {
  const title = 'It boots in a scratch kernel as a caged, not-official participant';
  const scratch = await mkdtemp(join(tmpdir(), 'brud-cli-add-'));

  try {
    const configPath = join(scratch, 'brud.config.json');
    const services = [...hardcoreModulePaths(kernel.root).map((path) => ({ path, official: true })), { path: dataPath, official: false }];

    await writeFile(configPath, JSON.stringify({ services }), 'utf8');
    await withScratchKernel(kernel, configPath, {}, async () => undefined);

    return { id: 'add.boot', title, status: 'pass' };
  } catch (error: unknown) {
    return bootFailure('add.boot', title, error);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * Looks at an unpacked package without importing or running any of its code:
 * its Brud data file, its npm manifest, compatibility with the installed kernel
 * and the current composition, and (for a caged package, which the cage
 * sandboxes) a boot in a scratch kernel.
 */
export async function inspectPackage(kernel: KernelPackage, isValidName: (name: string) => boolean, fetched: Fetched, packageDir: string, allowScripts: boolean, existing: readonly EntryInfo[]): Promise<Inspected> {
  const findings: Finding[] = [{ id: 'add.fetched', title: `Fetched ${fetched.name}@${fetched.version} (${fetched.integrity.slice(0, 19)}…) without running any of its code`, status: 'pass' }];
  const blank: Inspected = { findings, exposures: [], caged: false, native: false, requiresOfficial: false, powers: [] };
  const data = readDataFile(packageDir, fetched, isValidName, findings);

  if (data === undefined) {
    return blank;
  }

  const manifest = data.manifest as { exposures: unknown[] };
  const exposures = manifest.exposures.filter(isRecord).flatMap((exposure) => (typeof exposure.name === 'string' ? [exposure.name] : []));
  const requires = isRecord(data.requires) ? data.requires : undefined;
  const requiresOfficial = requires?.official === true;
  const powers = Array.isArray(requires?.powers) ? requires.powers.filter((power): power is string => typeof power === 'string') : [];
  const { caged, native } = checkModules(packageDir, data, findings);

  if (requiresOfficial) {
    findings.push({ id: 'add.requires', title: `It requires official (${powers.length === 0 ? 'no powers declared' : `powers: ${powers.join(', ')}`}): it cannot be added as a not-official entry`, status: 'info' });
  }

  checkManifest(packageDir, kernel.version, allowScripts, findings);

  const taken = new Set(existing.flatMap((entry) => entry.exposures));
  const clashes = exposures.filter((name) => taken.has(name));

  if (clashes.length > 0) {
    findings.push({ id: 'add.collision', title: 'Its exposure names are free in your composition', status: 'fail', cause: `already declared by another package: ${clashes.join(', ')} (EXPOSED_API_NAME_COLLISION)`, fix: 'Remove the other entry, or pin the intended owner under "exposureOwners".' });
  }

  if (caged && !requiresOfficial && !findings.some((finding) => finding.status === 'fail')) {
    findings.push(await bootInScratch(kernel, join(packageDir, 'brud.participant.json')));
  } else if (caged && requiresOfficial) {
    findings.push({ id: 'add.boot', title: 'Not booted in scratch: it requires official, so it cannot run caged', status: 'info' });
  }

  return { findings, exposures, caged, native, requiresOfficial, powers };
}
