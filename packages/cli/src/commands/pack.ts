import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { flagOn, flagText, type ParsedArgs } from '../args.js';
import { asHost, bootFailure, hardcoreModulePaths, withScratchKernel, type KernelPackage } from '../composition.js';
import { CommandError, describeError } from '../errors.js';
import type { Io } from '../io.js';
import { findPackageRoot, loadPackage } from '../project.js';
import { hasFailure, printFindings, type Finding, type Style } from '../report.js';

export const PACK_FLAGS = { boolean: ['verify'], value: ['out'] } as const;

/** The guest source description a participant author writes. */
export const SOURCE_FILE = 'brud.participant.src.json';
const KNOWN_KEYS = new Set(['id', 'manifest', 'limits', 'guest']);

interface Source {
  readonly id: string;
  readonly manifest: Record<string, unknown>;
  readonly limits: { readonly fuel: number; readonly maxMemoryBytes: number; readonly deadlineMs?: number };
  readonly guest: { readonly source?: string; readonly module?: string };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;

function insideDir(dir: string, path: string): string {
  const full = isAbsolute(path) ? path : resolve(dir, path);
  const rel = relative(dir, full);

  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new CommandError('PACK_SOURCE_INVALID', `${path} must stay inside the guest folder`);
  }

  return full;
}

/** Validates `brud.participant.src.json`. Unknown keys and a `requires` section are refused. */
function readSource(dir: string, isValidName: (name: string) => boolean): Source {
  const path = join(dir, SOURCE_FILE);

  if (!existsSync(path)) {
    throw new CommandError('PACK_SOURCE_MISSING', `no ${SOURCE_FILE} in ${dir} (scaffold one with \`brud init <name> --guest\`)`);
  }

  let data: unknown;

  try {
    data = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error: unknown) {
    throw new CommandError('PACK_SOURCE_INVALID', `${SOURCE_FILE} is not valid JSON (${describeError(error).message})`);
  }

  if (!isRecord(data)) {
    throw new CommandError('PACK_SOURCE_INVALID', `${SOURCE_FILE} must contain a JSON object`);
  }

  if ('requires' in data) {
    throw new CommandError('PACK_REQUIRES_OFFICIAL', 'this package requires official, so it cannot be built as a caged module. Ship it as a native participant the owner declares official, or remove "requires"');
  }

  const unknown = Object.keys(data).filter((key) => !KNOWN_KEYS.has(key));

  if (unknown.length > 0) {
    throw new CommandError('PACK_SOURCE_INVALID', `unknown key(s) in ${SOURCE_FILE}: ${unknown.join(', ')}`);
  }

  const { id, manifest, limits, guest } = data;

  if (typeof id !== 'string' || !isValidName(id)) {
    throw new CommandError('PACK_SOURCE_INVALID', `id "${String(id)}" is not a valid dotted lower-case name (for example acme.tasks)`);
  }

  if (!isRecord(manifest) || !Array.isArray(manifest.exposures)) {
    throw new CommandError('PACK_SOURCE_INVALID', 'manifest must be an object with an "exposures" array');
  }

  if (!isRecord(limits) || !positive(limits.fuel) || !positive(limits.maxMemoryBytes) || (limits.deadlineMs !== undefined && !positive(limits.deadlineMs))) {
    throw new CommandError('PACK_SOURCE_INVALID', 'limits needs positive integer fuel and maxMemoryBytes (deadlineMs is optional)');
  }

  if (!isRecord(guest) || (typeof guest.source === 'string') === (typeof guest.module === 'string')) {
    throw new CommandError('PACK_SOURCE_INVALID', 'guest must name exactly one of "source" (AssemblyScript) or "module" (a prebuilt .wasm)');
  }

  return { id, manifest, limits: limits as Source['limits'], guest: guest as Source['guest'] };
}

function compile(dir: string, source: string, outFile: string): Promise<void> {
  const root = findPackageRoot('assemblyscript', dir);

  if (root === undefined) {
    throw new CommandError('PACK_TOOLCHAIN_MISSING', 'assemblyscript is not installed in this guest project. Run `npm install --save-dev assemblyscript`, or name a prebuilt "module" instead of a "source"');
  }

  return new Promise((done, fail) => {
    execFile(process.execPath, [join(root, 'bin', 'asc.js'), source, '--outFile', outFile, '--optimize', '--runtime', 'stub', '--use', 'abort='], { cwd: dir }, (error, _stdout, stderr) => {
      if (error === null) {
        done();
      } else {
        fail(new CommandError('PACK_COMPILE_FAILED', `asc failed: ${stderr.trim().split('\n').slice(0, 6).join(' | ')}`));
      }
    });
  });
}

/** Boots a scratch kernel with the package (not official) and resolves every exposure it declares. */
async function verifyPackage(kernel: KernelPackage, manifestPath: string, source: Source): Promise<Finding[]> {
  const exposures = (source.manifest.exposures as unknown[]).filter(isRecord);
  const scratch = await mkdtemp(join(tmpdir(), 'brud-cli-pack-'));

  try {
    const configPath = join(scratch, 'brud.config.json');
    const services = [...hardcoreModulePaths(kernel.root).map((path) => ({ path, official: true })), { path: manifestPath, official: false }];

    await writeFile(configPath, JSON.stringify({ services }), 'utf8');

    return await withScratchKernel(kernel, configPath, {}, async (booted) => {
      const findings: Finding[] = [{ id: 'verify.boot', title: 'The package boots in a scratch kernel as a caged, not-official participant', status: 'pass' }];

      for (const exposure of exposures) {
        const name = String(exposure.name);
        const policy = isRecord(exposure.policy) ? exposure.policy : {};
        const needed = Array.isArray(policy.capabilities) ? policy.capabilities.filter((item): item is string => typeof item === 'string') : [];
        const resolves = (capabilities: readonly string[]): Promise<boolean> => asHost(kernel, booted, capabilities, (registry) => registry.resolve(name) !== null);
        const withCaps = await resolves(needed);
        const without = needed.length === 0 ? withCaps : await resolves([]);

        findings.push(!withCaps
          ? { id: `verify.${name}`, title: `Exposure ${name} resolves for a caller holding ${needed.length === 0 ? 'no capabilities' : needed.join(', ')}`, status: 'fail', cause: 'the exposure did not resolve', fix: 'Check the manifest exposure (name, version, scope, policy) and that the guest exports brud_alloc and brud_invoke.' }
          : needed.length > 0 && without
            ? { id: `verify.${name}`, title: `Exposure ${name} resolves, but also without its capabilities`, status: 'warn', cause: 'its policy asked for capabilities yet a caller with none resolved it', fix: 'Check the exposure policy (policyVersion 2, capabilities).' }
            : { id: `verify.${name}`, title: `Exposure ${name} resolves${needed.length === 0 ? '' : ` only with ${needed.join(', ')}`}`, status: 'pass' });
      }

      return findings;
    });
  } catch (error: unknown) {
    return [bootFailure('verify.boot', 'The package boots in a scratch kernel', error)];
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * `brud pack [dir]` (experimental): turns a guest folder into a participant
 * package, `participant.wasm` plus `brud.participant.json` with the module's
 * SHA-256. `--verify` then boots it in a scratch kernel.
 */
export async function runPack(io: Io, style: Style, args: ParsedArgs): Promise<number> {
  const dir = resolve(io.cwd, args.positionals[0] ?? '.');
  const sdk = await loadPackage<{ isValidName(name: string): boolean }>('@brud/sdk', dir).catch(() => {
    throw new CommandError('PACKAGE_NOT_FOUND', '@brud/sdk is not installed here. Run `npm install @brud/sdk` in your guest project.');
  });
  const source = readSource(dir, sdk.module.isValidName);
  const out = resolve(io.cwd, flagText(args, 'out') ?? join(dir, 'dist'));
  const findings: Finding[] = [{ id: 'pack.experimental', title: 'brud pack is experimental: one guest language (AssemblyScript) or a prebuilt .wasm', status: 'info' }];
  const wasmPath = join(out, 'participant.wasm');

  await mkdir(out, { recursive: true });

  if (source.guest.module === undefined) {
    await compile(dir, insideDir(dir, source.guest.source as string), wasmPath);
  } else {
    await copyFile(insideDir(dir, source.guest.module), wasmPath);
  }

  const sha256 = createHash('sha256').update(readFileSync(wasmPath)).digest('hex');
  const manifestPath = join(out, 'brud.participant.json');

  await writeFile(manifestPath, `${JSON.stringify({ format: 1, id: source.id, manifest: source.manifest, cage: { module: 'participant.wasm', sha256, limits: source.limits } }, null, 2)}\n`, 'utf8');
  findings.push({ id: 'pack.module', title: `Wrote ${wasmPath} (sha256 ${sha256.slice(0, 12)}…)`, status: 'pass' }, { id: 'pack.manifest', title: `Wrote ${manifestPath}`, status: 'pass' });

  if (flagOn(args, 'verify')) {
    const kernel = await loadPackage('@brud/kernel', dir).catch(() => {
      throw new CommandError('PACKAGE_NOT_FOUND', '@brud/kernel is not installed here, so --verify cannot boot the package.');
    });

    findings.push(...(await verifyPackage(kernel as KernelPackage, manifestPath, source)));
  }

  printFindings(io, style, findings, { out, sha256 });

  return hasFailure(findings) ? 1 : 0;
}
