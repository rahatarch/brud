import type { IStorageDriver } from '../../../drivers/contracts/index.js';
import type { FileMutationState } from './types.js';

const textEncoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  let output = '';

  for (const byte of bytes) {
    output += byte.toString(16).padStart(2, '0');
  }

  return output;
}

/**
 * Computes the lowercase SHA-256 digest of a payload.
 *
 * Uses Web Crypto so the filesystem service keeps no Node import for hashing.
 *
 * @param data - UTF-8 text or raw bytes.
 */
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const source = typeof data === 'string' ? textEncoder.encode(data) : data;
  const bytes = new Uint8Array(source.byteLength);
  bytes.set(source);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);

  return toHex(new Uint8Array(digest));
}

/** Byte length of a payload without allocating a buffer for binary input. */
export function payloadByteLength(data: string | Uint8Array): number {
  return typeof data === 'string' ? textEncoder.encode(data).byteLength : data.byteLength;
}

/** State used for a target that does not exist. */
export function missingState(): FileMutationState {
  return { exists: false, kind: 'missing', size: 0, sha256: null };
}

/** State used for a directory. */
export function directoryState(): FileMutationState {
  return { exists: true, kind: 'directory', size: 0, sha256: null };
}

/** Builds the intended file state from a payload before it is written. */
export async function fileStateFromPayload(
  data: string | Uint8Array,
): Promise<FileMutationState> {
  return {
    exists: true,
    kind: 'file',
    size: payloadByteLength(data),
    sha256: await sha256Hex(data),
  };
}

/**
 * Captures the current state of a validated absolute target through the
 * configured driver.
 *
 * The read is best-effort: a state whose bytes cannot be read is still
 * reported with its size and a `null` digest. Mutation success never depends
 * on the journal's ability to snapshot previous content.
 *
 * @param driver - Storage driver serving the validated path.
 * @param absolutePath - Path already canonicalized by `WorkspaceService`.
 */
export async function captureMutationState(
  driver: IStorageDriver,
  absolutePath: string,
): Promise<FileMutationState> {
  let stats;

  try {
    stats = await driver.stat(absolutePath);
  } catch {
    return missingState();
  }

  if (stats === null) {
    return missingState();
  }

  if (stats.isDirectory) {
    return directoryState();
  }

  try {
    const bytes = await driver.readFile(absolutePath);

    return {
      exists: true,
      kind: 'file',
      size: bytes.byteLength,
      sha256: await sha256Hex(bytes),
    };
  } catch {
    return {
      exists: true,
      kind: 'file',
      size: stats.size,
      sha256: null,
    };
  }
}
