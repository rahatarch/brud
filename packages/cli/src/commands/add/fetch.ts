import { existsSync, readdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CommandError } from '../../core/errors.js';
import { extractTarball, runNpm } from '../../core/npm.js';
import type { Fetched } from './types.js';

/** The first few `npm error` lines of an npm run, for one-line messages. */
export function npmErrorSummary(stderr: string): string {
  return stderr.trim().split('\n').filter((line) => line.includes('npm error')).slice(0, 3).join(' | ') || 'unknown error';
}

/** Whether `spec` names a file or folder on disk (relative to `cwd`) rather than a registry package. */
export function isLocalSpec(cwd: string, spec: string): boolean {
  return existsSync(resolve(cwd, spec));
}

/** Downloads the exact tarball into `scratch` without running any package script. */
export async function fetchTarball(spec: string, cwd: string, scratch: string): Promise<Fetched> {
  const target = isLocalSpec(cwd, spec) ? resolve(cwd, spec) : spec;
  const result = await runNpm(['pack', target, '--pack-destination', '.', '--json', '--ignore-scripts', '--no-audit', '--no-fund'], scratch);

  if (result.code !== 0) {
    throw new CommandError('ADD_FETCH_FAILED', `npm could not fetch ${spec}: ${npmErrorSummary(result.stderr)}`);
  }

  const start = result.stdout.indexOf('[');
  const info = (JSON.parse(result.stdout.slice(start)) as { name: string; version: string; filename: string; integrity: string }[])[0];

  if (info === undefined) {
    throw new CommandError('ADD_FETCH_FAILED', `npm returned no package for ${spec}`);
  }

  return { name: info.name, version: info.version, integrity: info.integrity, tarball: join(scratch, info.filename.replace(/^@/u, '').replace('/', '-')) };
}

/** Unpacks the tarball under `scratch` and returns the folder that holds the package files. */
export async function unpack(fetched: Fetched, scratch: string): Promise<string> {
  const unpacked = join(scratch, 'unpacked');

  await mkdir(unpacked);
  await extractTarball(fetched.tarball, unpacked);

  const found = readdirSync(unpacked);

  return join(unpacked, found.includes('package') ? 'package' : (found[0] ?? 'package'));
}
