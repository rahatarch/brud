import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CommandError } from '../../../core/errors.js';
import { RUNTIME_DIR } from '../../../core/paths.js';
import { RUNTIME_SHA256 } from './runtimeInfo.js';

/** The prebuilt JavaScript runtime shipped with this CLI (QuickJS behind the cage's guest interface). */
export const RUNTIME_FILE = join(RUNTIME_DIR, 'quickjs.wasm');

/**
 * Loads the JavaScript runtime and checks it against the digest pinned in this
 * CLI's code, so a swapped binary is refused before anything is built from it.
 *
 * @throws {CommandError} `PACK_RUNTIME_MISSING` or `PACK_RUNTIME_TAMPERED`.
 */
export function loadRuntime(file = RUNTIME_FILE, expected = RUNTIME_SHA256): Buffer {
  if (!existsSync(file)) {
    throw new CommandError('PACK_RUNTIME_MISSING', 'the JavaScript runtime is missing from this install of @brud/cli; reinstall it');
  }

  const bytes = readFileSync(file);

  if (createHash('sha256').update(bytes).digest('hex') !== expected) {
    throw new CommandError('PACK_RUNTIME_TAMPERED', 'the JavaScript runtime does not match the digest pinned in @brud/cli; reinstall it and do not use this copy');
  }

  return bytes;
}
