import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { flagOn, flagText, UsageError, type ParsedArgs } from '../args.js';
import {
  bootFailure,
  hardcoreModulePaths,
  readComposition,
  resolveConfigPath,
  withScratchKernel,
  type EntryInfo,
  type KernelPackage,
} from '../composition.js';
import { CommandError } from '../errors.js';
import type { Io } from '../io.js';
import { assertSafeArgument, extractTarball, runNpm } from '../npm.js';
import { loadPackage, satisfies } from '../project.js';
import { hasFailure, printFindings, type Finding, type Style } from '../report.js';

export const ADD_FLAGS = { boolean: ['dry-run', 'write', 'allow-scripts'], value: ['config'] } as const;

const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

interface Fetched {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
  readonly tarball: string;
}

/** What preflight learned about a package, for the install step and the final instructions. */
interface Inspected {
  readonly findings: Finding[];
  readonly packageDir: string;
  readonly exposures: readonly string[];
  readonly caged: boolean;
  readonly native: boolean;
  readonly requiresOfficial: boolean;
  readonly powers: readonly string[];
}

/** Downloads the exact tarball into `scratch` without running any package script. */
async function fetchTarball(spec: string, cwd: string, scratch: string): Promise<Fetched> {
  const local = resolve(cwd, spec);
  const target = existsSync(local) ? local : spec;
  const result = await runNpm(['pack', target, '--pack-destination', '.', '--json', '--ignore-scripts', '--no-audit', '--no-fund'], scratch);

  if (result.code !== 0) {
    throw new CommandError('ADD_FETCH_FAILED', `npm could not fetch ${spec}: ${result.stderr.trim().split('\n').filter((line) => line.includes('npm error')).slice(0, 3).join(' | ') || 'unknown error'}`);
  }

  const start = result.stdout.indexOf('[');
  const info = (JSON.parse(result.stdout.slice(start)) as { name: string; version: string; filename: string; integrity: string }[])[0];

  if (info === undefined) {
    throw new CommandError('ADD_FETCH_FAILED', `npm returned no package for ${spec}`);
  }

  return { name: info.name, version: info.version, integrity: info.integrity, tarball: join(scratch, info.filename.replace(/^@/u, '').replace('/', '-')) };
}

function insidePackage(dir: string, path: unknown): string | undefined {
  if (typeof path !== 'string') {
    return undefined;
  }

  const full = resolve(dir, path);
  const rel = relative(dir, full);

  return rel.startsWith('..') || isAbsolute(rel) ? undefined : full;
}

/**
 * Looks at an unpacked package without importing or running any of its code:
 * its Brud data file, its npm manifest, compatibility with the installed kernel
 * and with the current composition, and (for a caged package, which the cage
 * sandboxes) a boot in a scratch kernel.
 */
async function inspect(kernel: KernelPackage, isValidName: (name: string) => boolean, fetched: Fetched, packageDir: string, allowScripts: boolean, existing: readonly EntryInfo[]): Promise<Inspected> {
  const findings: Finding[] = [{ id: 'add.fetched', title: `Fetched ${fetched.name}@${fetched.version} (${fetched.integrity.slice(0, 19)}…) without running any of its code`, status: 'pass' }];
  const blank = { findings, packageDir, exposures: [], caged: false, native: false, requiresOfficial: false, powers: [] } as const;
  const dataPath = join(packageDir, 'brud.participant.json');

  if (!existsSync(dataPath)) {
    findings.push({ id: 'add.brud', title: `${fetched.name} is a Brud participant package`, status: 'fail', cause: 'it has no brud.participant.json, so it is an ordinary npm package', fix: `Install ordinary packages with \`npm install ${fetched.name}\`; \`brud add\` is for Brud participants.` });

    return blank;
  }

  let data: unknown;

  try {
    data = JSON.parse(readFileSync(dataPath, 'utf8')) as unknown;
  } catch {
    findings.push({ id: 'add.brud', title: `${fetched.name} has a valid brud.participant.json`, status: 'fail', cause: 'the file is not valid JSON', fix: 'Ask the package author to fix and republish it.' });

    return blank;
  }

  if (!isRecord(data) || data.format !== 1 || typeof data.id !== 'string' || !isValidName(data.id) || !isRecord(data.manifest) || !Array.isArray(data.manifest.exposures)) {
    findings.push({ id: 'add.brud', title: `${fetched.name} has a valid brud.participant.json`, status: 'fail', cause: 'it needs format 1, a dotted lower-case id, and a manifest with an "exposures" array', fix: 'Ask the package author to fix and republish it.' });

    return blank;
  }

  findings.push({ id: 'add.brud', title: `${fetched.name} is a Brud participant package (id ${data.id})`, status: 'pass' });

  const exposures = data.manifest.exposures.filter(isRecord).flatMap((exposure) => (typeof exposure.name === 'string' ? [exposure.name] : []));
  const requires = isRecord(data.requires) ? data.requires : undefined;
  const requiresOfficial = requires?.official === true;
  const powers = Array.isArray(requires?.powers) ? requires.powers.filter((power): power is string => typeof power === 'string') : [];
  const cage = isRecord(data.cage) ? data.cage : undefined;
  const nativePath = data.native === undefined ? undefined : insidePackage(packageDir, data.native);
  const caged = cage !== undefined;
  const native = nativePath !== undefined;

  if (!caged && data.native === undefined) {
    findings.push({ id: 'add.kind', title: 'The package declares how it runs', status: 'fail', cause: 'it has neither a "cage" section (WebAssembly) nor a "native" entry', fix: 'Ask the package author to fix and republish it.' });
  }

  if (cage !== undefined) {
    const module = insidePackage(packageDir, cage.module);
    const digest = module !== undefined && existsSync(module) ? createHash('sha256').update(readFileSync(module)).digest('hex') : undefined;

    findings.push(digest !== undefined && digest === cage.sha256
      ? { id: 'add.cage', title: 'The cage module is inside the package and matches its sha256', status: 'pass' }
      : { id: 'add.cage', title: 'The cage module is inside the package and matches its sha256', status: 'fail', cause: digest === undefined ? 'cage.module is missing or points outside the package' : 'the module\'s sha256 differs from cage.sha256 (the kernel would refuse it)', fix: 'Do not use this package version; tell the author.' });
  }

  if (data.native !== undefined) {
    findings.push(nativePath !== undefined && existsSync(nativePath)
      ? { id: 'add.native', title: 'It ships a native entry, which runs only if you declare the entry official (it was not imported)', status: 'info' }
      : { id: 'add.native', title: 'The native entry is inside the package', status: 'fail', cause: 'native is missing or points outside the package', fix: 'Do not use this package version; tell the author.' });
  }

  if (requiresOfficial) {
    findings.push({ id: 'add.requires', title: `It requires official (${powers.length === 0 ? 'no powers declared' : `powers: ${powers.join(', ')}`}): it cannot be added as a not-official entry`, status: 'info' });
  }

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
    : satisfies(kernel.version, range)
      ? { id: 'add.compat', title: `Its @brud/kernel range ${range} includes your installed ${kernel.version}`, status: 'pass' }
      : { id: 'add.compat', title: `Its @brud/kernel range ${range} includes your installed ${kernel.version}`, status: 'fail', cause: `this package wants @brud/kernel ${range}`, fix: 'Use a version of the package that supports your kernel, or update the kernel.' });

  const taken = new Set(existing.flatMap((entry) => entry.exposures));
  const clashes = exposures.filter((name) => taken.has(name));

  if (clashes.length > 0) {
    findings.push({ id: 'add.collision', title: 'Its exposure names are free in your composition', status: 'fail', cause: `already declared by another package: ${clashes.join(', ')} (EXPOSED_API_NAME_COLLISION)`, fix: 'Remove the other entry, or pin the intended owner under "exposureOwners".' });
  }

  if (caged && !requiresOfficial && !findings.some((finding) => finding.status === 'fail')) {
    const scratch = await mkdtemp(join(tmpdir(), 'brud-cli-add-'));

    try {
      const configPath = join(scratch, 'brud.config.json');

      await writeFile(configPath, JSON.stringify({ services: [...hardcoreModulePaths(kernel.root).map((path) => ({ path, official: true })), { path: dataPath, official: false }] }), 'utf8');
      await withScratchKernel(kernel, configPath, {}, async () => undefined);
      findings.push({ id: 'add.boot', title: 'It boots in a scratch kernel as a caged, not-official participant', status: 'pass' });
    } catch (error: unknown) {
      findings.push(bootFailure('add.boot', 'It boots in a scratch kernel as a caged, not-official participant', error));
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  } else if (caged && requiresOfficial) {
    findings.push({ id: 'add.boot', title: 'Not booted in scratch: it requires official, so it cannot run caged', status: 'info' });
  }

  return { findings, packageDir, exposures, caged, native, requiresOfficial, powers };
}

/** The `sha512-…` digest npm records for a tarball file. */
const tarballIntegrity = (file: string): string => `sha512-${createHash('sha512').update(readFileSync(file)).digest('base64')}`;

function lockedIntegrity(cwd: string, name: string): string | undefined {
  const lock = join(cwd, 'package-lock.json');

  if (!existsSync(lock)) {
    return undefined;
  }

  const packages = (JSON.parse(readFileSync(lock, 'utf8')) as { packages?: Record<string, { integrity?: string }> }).packages;

  return packages?.[`node_modules/${name}`]?.integrity;
}

/** The composition entry path for the installed package, relative to the composition file. */
function entryPath(configPath: string, projectDir: string, name: string): string {
  const rel = relative(dirname(configPath), join(projectDir, 'node_modules', ...name.split('/'), 'brud.participant.json')).split(sep).join('/');

  return rel.startsWith('.') ? rel : `./${rel}`;
}

/** Appends a not-official entry to the composition's "services", keeping every other top-level key. */
function writeEntry(configPath: string, path: string): 'added' | 'present' {
  const document = JSON.parse(readFileSync(configPath, 'utf8')) as { services?: { path: string }[] };

  if (!Array.isArray(document.services)) {
    throw new CommandError('CONFIG_SCHEMA', `${configPath} has no "services" array to add to`);
  }

  if (document.services.some((entry) => entry.path === path)) {
    return 'present';
  }

  document.services.push({ path, official: false } as { path: string });
  writeFileSync(configPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

  return 'added';
}

/**
 * `brud add <package>`: adds a Brud participant package to this project.
 *
 * 1. Fetch the exact tarball into a scratch folder and inspect it without
 *    running or importing any of its code. A package that is not a Brud
 *    participant, is malformed, does not match its hash, does not fit your
 *    kernel or collides with your composition stops here and nothing is
 *    installed.
 * 2. Install that exact version with `npm install --ignore-scripts`, then check
 *    that the installed bytes are the ones that were inspected.
 * 3. Print the composition entry to add. It never declares anything official.
 *    `--write` adds a not-official entry for a caged package, and only that.
 */
export async function runAdd(io: Io, style: Style, args: ParsedArgs): Promise<number> {
  const spec = args.positionals[0];

  if (spec === undefined) {
    throw new UsageError('brud add needs a package: `brud add <name[@version] | ./file.tgz | ./folder>`');
  }

  assertSafeArgument(spec, 'package');

  if (!existsSync(join(io.cwd, 'package.json'))) {
    throw new CommandError('ADD_NO_PROJECT', 'there is no package.json here. Run `brud add` inside a project (create one with `brud init`).');
  }

  const kernel = (await loadPackage('@brud/kernel', io.cwd).catch(() => {
    throw new CommandError('PACKAGE_NOT_FOUND', '@brud/kernel is not installed here. Run `npm install @brud/kernel @brud/sdk` first.');
  })) as KernelPackage;
  const sdk = await loadPackage<{ isValidName(name: string): boolean }>('@brud/sdk', io.cwd).catch(() => {
    throw new CommandError('PACKAGE_NOT_FOUND', '@brud/sdk is not installed here. Run `npm install @brud/sdk` first.');
  });
  const configPath = resolveConfigPath(io.cwd, flagText(args, 'config'));
  const existing = existsSync(configPath) ? readComposition(kernel, configPath).entries : [];
  const scratch = await mkdtemp(join(tmpdir(), 'brud-cli-fetch-'));

  try {
    const fetched = await fetchTarball(spec, io.cwd, scratch);
    const unpacked = join(scratch, 'unpacked');

    await import('node:fs/promises').then(({ mkdir }) => mkdir(unpacked));
    await extractTarball(fetched.tarball, unpacked);

    const found = readdirSync(unpacked);
    const inspected = await inspect(kernel, sdk.module.isValidName, fetched, join(unpacked, found.includes('package') ? 'package' : (found[0] ?? 'package')), flagOn(args, 'allow-scripts'), existing);
    const findings = [...inspected.findings];

    if (hasFailure(findings)) {
      findings.push({ id: 'add.result', title: `Nothing was installed`, status: 'info' });
      printFindings(io, style, findings, { name: fetched.name, version: fetched.version, installed: false });

      return 1;
    }

    if (flagOn(args, 'dry-run')) {
      findings.push({ id: 'add.result', title: 'Dry run: nothing was installed', status: 'info' });
      printFindings(io, style, findings, { name: fetched.name, version: fetched.version, installed: false });

      return 0;
    }

    const local = existsSync(resolve(io.cwd, spec));
    const installSpec = local ? resolve(io.cwd, spec) : `${fetched.name}@${fetched.version}`;
    const install = await runNpm(['install', installSpec, '--ignore-scripts', ...(flagOn(args, 'allow-scripts') ? [] : []), '--no-audit', '--no-fund'].filter((value) => !(flagOn(args, 'allow-scripts') && value === '--ignore-scripts')), io.cwd);

    if (install.code !== 0) {
      throw new CommandError('ADD_INSTALL_FAILED', `npm install failed: ${install.stderr.trim().split('\n').filter((line) => line.includes('npm error')).slice(0, 3).join(' | ') || 'unknown error'}`);
    }

    const expected = local && fetched.tarball.endsWith('.tgz') && resolve(io.cwd, spec).endsWith('.tgz') ? tarballIntegrity(resolve(io.cwd, spec)) : fetched.integrity;
    const locked = lockedIntegrity(io.cwd, fetched.name);

    if (locked !== undefined && !(local && !resolve(io.cwd, spec).endsWith('.tgz')) && locked !== expected) {
      findings.push({ id: 'add.integrity', title: 'The installed package is the one that was inspected', status: 'fail', cause: `the lockfile records ${locked} but the inspected tarball is ${expected}`, fix: `Remove it with \`npm uninstall ${fetched.name}\` and try again; the registry served different bytes.` });
      printFindings(io, style, findings, { name: fetched.name, version: fetched.version, installed: true });

      return 1;
    }

    findings.push(locked === undefined || (local && !resolve(io.cwd, spec).endsWith('.tgz'))
      ? { id: 'add.integrity', title: 'Installed (the installed bytes were not compared with the inspected ones: local folder or no lockfile)', status: 'info' }
      : { id: 'add.integrity', title: 'The installed package is the one that was inspected (integrity matches)', status: 'pass' });

    const path = entryPath(configPath, io.cwd, fetched.name);
    const mayWrite = inspected.caged && !inspected.requiresOfficial;
    let entry = `{ "path": "${path}", "official": false }`;

    if (flagOn(args, 'write')) {
      if (!mayWrite) {
        findings.push({ id: 'add.write', title: 'Not written to the composition', status: 'warn', cause: '--write adds only a not-official entry for a caged package; this one needs an official decision', fix: 'Review its code, then add the line below yourself if you trust it.' });
      } else if (!existsSync(configPath)) {
        findings.push({ id: 'add.write', title: 'Not written to the composition', status: 'warn', cause: `no composition at ${configPath}`, fix: 'Create one with `brud init`, or pass --config <path>.' });
      } else {
        findings.push({ id: 'add.write', title: `${writeEntry(configPath, path) === 'added' ? 'Added' : 'Already listed:'} ${path} (not official) in ${configPath}`, status: 'pass' });
      }
    }

    if (!mayWrite) {
      entry = `{ "path": "${path}", "official": true }`;
    }

    const advice = mayWrite
      ? `Add to "services" in ${configPath}${flagOn(args, 'write') ? ' (done)' : ''}: ${`{ "path": "${path}", "official": false }`}\nIt runs caged; it can only use what its manifest requests and the givers allow.`
      : `This package runs as trusted native code only if you declare it official. Review its code first. If you trust it, add: ${entry}\nUntil then it is installed but not part of your composition.`;

    findings.push({ id: 'add.result', title: `Installed ${fetched.name}@${fetched.version}`, status: 'pass' }, { id: 'add.next', title: advice, status: 'info' }, { id: 'add.verify', title: 'Then run `brud check` to confirm the composition boots', status: 'info' });
    printFindings(io, style, findings, { name: fetched.name, version: fetched.version, installed: true, entry: { path, official: mayWrite ? false : null }, caged: inspected.caged, native: inspected.native, requiresOfficial: inspected.requiresOfficial });

    return hasFailure(findings) ? 1 : 0;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
