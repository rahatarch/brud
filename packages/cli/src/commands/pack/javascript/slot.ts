import { CommandError } from '../../../core/errors.js';

/**
 * The runtime module holds a fixed slot for the participant's script, laid out
 * (little endian) as: 16-byte marker, u32 capacity, u32 script length, script
 * bytes, one NUL. `runtime/quickjs/shim.c` defines it; this module fills it.
 */
const MARKER = Buffer.from('BRUD-JS-SLOT-v1\0', 'latin1');
const CAPACITY_AT = MARKER.length;
const LENGTH_AT = CAPACITY_AT + 4;
const SCRIPT_AT = LENGTH_AT + 4;

/**
 * Returns a copy of the runtime with `script` written into its slot.
 *
 * @throws {CommandError} `PACK_RUNTIME_INVALID` when the slot is missing or not unique; `PACK_SCRIPT_TOO_LARGE` when the script does not fit.
 */
export function fillSlot(runtime: Uint8Array, script: string): Buffer {
  const bytes = Buffer.from(runtime);
  const at = bytes.indexOf(MARKER);

  if (at === -1 || bytes.indexOf(MARKER, at + 1) !== -1) {
    throw new CommandError('PACK_RUNTIME_INVALID', 'the JavaScript runtime has no single script slot; reinstall @brud/cli');
  }

  const capacity = bytes.readUInt32LE(at + CAPACITY_AT);
  const source = Buffer.from(script, 'utf8');

  if (source.length > capacity) {
    throw new CommandError('PACK_SCRIPT_TOO_LARGE', `the bundled script is ${source.length} bytes; a JavaScript guest holds at most ${capacity} (${Math.round(capacity / 1024)} KiB). Remove large dependencies or split the participant`);
  }

  bytes.writeUInt32LE(source.length, at + LENGTH_AT);
  source.copy(bytes, at + SCRIPT_AT);

  return bytes;
}

/** Reads back the script a filled runtime carries (for tests and `inspect`-style tooling). */
export function readSlot(module: Uint8Array): string | undefined {
  const bytes = Buffer.from(module);
  const at = bytes.indexOf(MARKER);

  if (at === -1) {
    return undefined;
  }

  return bytes.subarray(at + SCRIPT_AT, at + SCRIPT_AT + bytes.readUInt32LE(at + LENGTH_AT)).toString('utf8');
}
