import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fillSlot, readSlot } from './slot.js';

function fakeRuntime(capacity: number, markers = 1): Buffer {
  const slot = Buffer.alloc(16 + 4 + 4 + capacity + 1);

  Buffer.from('BRUD-JS-SLOT-v1\0', 'latin1').copy(slot);
  slot.writeUInt32LE(capacity, 16);

  return Buffer.concat([Buffer.from('prefix'), ...Array.from({ length: markers }, () => slot), Buffer.from('suffix')]);
}

test('fillSlot writes the script and its length without changing the rest of the module', () => {
  const runtime = fakeRuntime(64);
  const filled = fillSlot(runtime, 'globalThis.handler = () => 1;');

  assert.equal(readSlot(filled), 'globalThis.handler = () => 1;');
  assert.equal(filled.length, runtime.length);
  assert.equal(filled.subarray(0, 6).toString(), 'prefix');
  assert.equal(filled.subarray(-6).toString(), 'suffix');
  assert.equal(readSlot(runtime), '');
});

test('fillSlot handles multi-byte text and refuses an oversized script, a missing slot and a repeated marker', () => {
  assert.equal(readSlot(fillSlot(fakeRuntime(64), 'é中')), 'é中');
  assert.throws(() => fillSlot(fakeRuntime(8), 'x'.repeat(9)), /PACK_SCRIPT_TOO_LARGE|holds at most 8/u);
  assert.throws(() => fillSlot(Buffer.from('no slot here'), 'x'), /no single script slot/u);
  assert.throws(() => fillSlot(fakeRuntime(8, 2), 'x'), /no single script slot/u);
});
