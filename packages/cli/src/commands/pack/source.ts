import { existsSync, readFileSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { CommandError, describeError } from '../../core/errors.js';

/** The guest source description a participant author writes. */
export const SOURCE_FILE = 'brud.participant.src.json';

/** Languages `brud pack` can compile into a cage guest. */
export type GuestLanguage = 'assemblyscript' | 'javascript';

export interface Limits {
  readonly fuel: number;
  readonly maxMemoryBytes: number;
  readonly deadlineMs?: number;
}

export interface Source {
  readonly id: string;
  readonly manifest: Record<string, unknown>;
  readonly limits: Limits;
  readonly guest: { readonly source?: string; readonly module?: string; readonly language: GuestLanguage };
}

const KNOWN_KEYS = new Set(['id', 'manifest', 'limits', 'guest']);
const KNOWN_GUEST_KEYS = new Set(['source', 'module', 'language']);
const SCRIPT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.mts', '.cts']);

/** The minimum memory a JavaScript guest needs: the engine's own 8 MiB plus room for the script's heap. */
export const JAVASCRIPT_MIN_MEMORY_BYTES = 16 * 1024 * 1024;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;

/** A path that must stay inside the guest folder. */
export function insideDir(dir: string, path: string): string {
  const full = isAbsolute(path) ? path : resolve(dir, path);
  const rel = relative(dir, full);

  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new CommandError('PACK_SOURCE_INVALID', `${path} must stay inside the guest folder`);
  }

  return full;
}

/**
 * The language of a guest source: `.js`, `.mjs` and similar files are JavaScript;
 * a `.ts` file is AssemblyScript unless `language` says "javascript" (it is
 * TypeScript compiled by the JavaScript path).
 */
export function languageOf(guest: Record<string, unknown>): GuestLanguage {
  const declared = guest.language;

  if (declared !== undefined && declared !== 'assemblyscript' && declared !== 'javascript') {
    throw new CommandError('PACK_SOURCE_INVALID', 'guest.language must be "assemblyscript" or "javascript"');
  }

  if (declared !== undefined) {
    return declared;
  }

  return typeof guest.source === 'string' && SCRIPT_EXTENSIONS.has(extname(guest.source)) ? 'javascript' : 'assemblyscript';
}

function readGuest(guest: unknown): Source['guest'] {
  if (!isRecord(guest) || (typeof guest.source === 'string') === (typeof guest.module === 'string')) {
    throw new CommandError('PACK_SOURCE_INVALID', 'guest must name exactly one of "source" (AssemblyScript, JavaScript or TypeScript) or "module" (a prebuilt .wasm)');
  }

  const unknown = Object.keys(guest).filter((key) => !KNOWN_GUEST_KEYS.has(key));

  if (unknown.length > 0) {
    throw new CommandError('PACK_SOURCE_INVALID', `unknown key(s) in guest: ${unknown.join(', ')}`);
  }

  if (typeof guest.module === 'string' && guest.language !== undefined) {
    throw new CommandError('PACK_SOURCE_INVALID', 'guest.language applies to a "source", not to a prebuilt "module"');
  }

  return { ...(typeof guest.source === 'string' ? { source: guest.source } : { module: guest.module as string }), language: languageOf(guest) };
}

/** Validates `brud.participant.src.json`. Unknown keys and a `requires` section are refused. */
export function readSource(dir: string, isValidName: (name: string) => boolean): Source {
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

  const { id, manifest, limits } = data;

  if (typeof id !== 'string' || !isValidName(id)) {
    throw new CommandError('PACK_SOURCE_INVALID', `id "${String(id)}" is not a valid dotted lower-case name (for example acme.tasks)`);
  }

  if (!isRecord(manifest) || !Array.isArray(manifest.exposures)) {
    throw new CommandError('PACK_SOURCE_INVALID', 'manifest must be an object with an "exposures" array');
  }

  if (!isRecord(limits) || !positive(limits.fuel) || !positive(limits.maxMemoryBytes) || (limits.deadlineMs !== undefined && !positive(limits.deadlineMs))) {
    throw new CommandError('PACK_SOURCE_INVALID', 'limits needs positive integer fuel and maxMemoryBytes (deadlineMs is optional)');
  }

  const guest = readGuest(data.guest);

  if (guest.language === 'javascript' && guest.module === undefined && limits.maxMemoryBytes < JAVASCRIPT_MIN_MEMORY_BYTES) {
    throw new CommandError('PACK_SOURCE_INVALID', `a JavaScript guest needs limits.maxMemoryBytes of at least ${JAVASCRIPT_MIN_MEMORY_BYTES} (16 MiB): the JavaScript engine itself uses 8 MiB`);
  }

  return { id, manifest, limits: limits as unknown as Limits, guest };
}
