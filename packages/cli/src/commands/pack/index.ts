import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { flagOn, flagText, type ParsedArgs } from '../../core/args.js';
import type { KernelPackage } from '../../composition/load.js';
import { CommandError } from '../../core/errors.js';
import type { Io } from '../../core/io.js';
import { loadPackage } from '../../core/project.js';
import { hasFailure, printFindings, type Finding, type Style } from '../../core/report.js';
import { compileAssemblyScript } from './assemblyscript.js';
import { buildJavaScriptGuest } from './javascript/index.js';
import { insideDir, readSource, type Source } from './source.js';
import { verifyPackage } from './verify.js';

export const PACK_FLAGS = { boolean: ['verify'], value: ['out'] } as const;

/** Fuel a JavaScript guest uses per simple loop step is about 2,000 (AssemblyScript: about 22), so tiny budgets run out fast. */
const JAVASCRIPT_COMFORTABLE_FUEL = 2_000_000_000;

/** Builds `participant.wasm` for the source's language and returns notes about the build. */
async function buildGuest(dir: string, source: Source, wasmPath: string): Promise<Finding[]> {
  if (source.guest.module !== undefined) {
    await copyFile(insideDir(dir, source.guest.module), wasmPath);

    return [{ id: 'pack.language', title: 'Using the prebuilt .wasm as is', status: 'info' }];
  }

  const entry = insideDir(dir, source.guest.source as string);

  if (source.guest.language === 'assemblyscript') {
    await compileAssemblyScript(dir, entry, wasmPath);

    return [{ id: 'pack.language', title: 'Compiled AssemblyScript ahead of time: the cage runs native-speed code', status: 'info' }];
  }

  const { scriptBytes } = await buildJavaScriptGuest(dir, entry, wasmPath);
  const notes: Finding[] = [{ id: 'pack.language', title: `Bundled JavaScript (${scriptBytes} bytes) into the QuickJS runtime. It runs in the cage as an interpreter: expect it to be much slower than AssemblyScript on heavy work, with about 650 ms extra when the participant starts`, status: 'info' }];

  if (source.limits.fuel < JAVASCRIPT_COMFORTABLE_FUEL) {
    notes.push({ id: 'pack.fuel', title: `limits.fuel ${source.limits.fuel} is low for JavaScript`, status: 'warn', cause: 'the interpreter spends about 2,000 fuel per simple loop step, so a million steps need about 2,000,000,000', fix: 'Raise limits.fuel (and deadlineMs) to what your handler needs; measure with `brud pack --verify` and a real call.' });
  }

  return notes;
}

/**
 * `brud pack [dir]` (experimental): turns a guest folder into a participant
 * package, `participant.wasm` plus `brud.participant.json` with the module's
 * SHA-256. The guest is AssemblyScript (compiled ahead of time), JavaScript or
 * TypeScript (bundled into a prebuilt QuickJS runtime), or a prebuilt `.wasm`.
 * `--verify` then boots it in a scratch kernel.
 */
export async function runPack(io: Io, style: Style, args: ParsedArgs): Promise<number> {
  const dir = resolve(io.cwd, args.positionals[0] ?? '.');
  const sdk = await loadPackage<{ isValidName(name: string): boolean }>('@brud/sdk', dir).catch(() => {
    throw new CommandError('PACKAGE_NOT_FOUND', '@brud/sdk is not installed here. Run `npm install @brud/sdk` in your guest project.');
  });
  const source = readSource(dir, sdk.module.isValidName);
  const out = resolve(io.cwd, flagText(args, 'out') ?? join(dir, 'dist'));
  const findings: Finding[] = [{ id: 'pack.experimental', title: 'brud pack is experimental: AssemblyScript, JavaScript/TypeScript, or a prebuilt .wasm', status: 'info' }];
  const wasmPath = join(out, 'participant.wasm');

  await mkdir(out, { recursive: true });
  findings.push(...(await buildGuest(dir, source, wasmPath)));

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

  printFindings(io, style, findings, { out, sha256, language: source.guest.language });

  return hasFailure(findings) ? 1 : 0;
}
