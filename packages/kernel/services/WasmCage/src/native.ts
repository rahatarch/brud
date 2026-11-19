import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WASM_CAGE_NATIVE_DIGESTS } from './nativeDigests.js';

/**
 * Per-platform native binary loading for the WASM cage.
 *
 * Binaries are named `brud-wasm-cage.<platform-key>.node` and live in the
 * package's `services/WasmCage/native/` folder, which ships in the npm package.
 * The loader finds that folder from source and from `dist/`, checks the binary's
 * SHA-256 against the pinned digest table, and only then loads it. A platform
 * with no listed binary, a missing file, or a digest mismatch fails closed; the
 * kernel itself still boots, and only caged participants are unavailable.
 */

/** Error codes of the native loader. */
export type CageNativeErrorCode = 'WASM_CAGE_NATIVE_UNAVAILABLE' | 'WASM_CAGE_NATIVE_TAMPERED';

/** The cage's native binary is unavailable or failed its digest check. */
export class CageNativeError extends Error {
  public readonly code: CageNativeErrorCode;

  constructor(code: CageNativeErrorCode, message: string) {
    super(message);
    this.name = 'CageNativeError';
    this.code = code;
  }
}

/** The running platform's key, e.g. `linux-x64-gnu`, `darwin-arm64`, `win32-x64-msvc`. */
export function nativePlatformKey(): string {
  const { platform, arch } = process;

  if (platform === 'linux') {
    const report = process.report.getReport() as { header?: { glibcVersionRuntime?: string } };

    return `linux-${arch}-${report.header?.glibcVersionRuntime === undefined ? 'musl' : 'gnu'}`;
  }

  return platform === 'win32' ? `win32-${arch}-msvc` : `${platform}-${arch}`;
}

/** The binary's file name for a platform key. */
export function nativeBinaryName(key: string): string {
  return `brud-wasm-cage.${key}.node`;
}

/**
 * Candidate native folders: next to this module, and, when this module runs
 * from `dist/`, the same folder in the package's shipped source tree.
 */
function nativeFolders(): readonly string[] {
  const here = fileURLToPath(new URL('../native/', import.meta.url));
  const dist = here.lastIndexOf(`${sep}dist${sep}`);

  return dist === -1 ? [here] : [here, here.slice(0, dist) + here.slice(dist + `${sep}dist`.length)];
}

const DIGESTS: ReadonlyMap<string, string> = new Map(WASM_CAGE_NATIVE_DIGESTS);

let loaded: unknown;

/**
 * Loads the verified native binary for the running platform.
 *
 * @returns The binary's exports.
 * @throws {CageNativeError} When no binary is listed or present for the
 *   platform, or the binary's digest does not match the pinned table.
 */
export function loadVerifiedNative<T>(): T {
  if (loaded !== undefined) {
    return loaded as T;
  }

  const key = nativePlatformKey();
  const expected = DIGESTS.get(key);

  if (expected === undefined) {
    throw new CageNativeError('WASM_CAGE_NATIVE_UNAVAILABLE', `no WASM cage binary is published for platform "${key}"`);
  }

  const path = nativeFolders().map((folder) => folder + nativeBinaryName(key)).find((candidate) => existsSync(candidate));

  if (path === undefined) {
    throw new CageNativeError('WASM_CAGE_NATIVE_UNAVAILABLE', `the WASM cage binary for platform "${key}" is missing`);
  }

  const actual = createHash('sha256').update(readFileSync(path)).digest('hex');

  if (actual !== expected) {
    throw new CageNativeError('WASM_CAGE_NATIVE_TAMPERED', `the WASM cage binary for platform "${key}" failed its digest check`);
  }

  loaded = createRequire(import.meta.url)(path) as unknown;

  return loaded as T;
}
