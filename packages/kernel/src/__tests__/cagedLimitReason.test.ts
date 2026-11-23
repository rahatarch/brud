import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { limitReason } from '../../services/WasmCage/src/caged.js';

const BACKTRACE = 'error while executing at wasm backtrace:\n    0:  0xd4621 - <unknown>!<wasm function 1228>\n    1:  0xd4f86 - <unknown>!<wasm function 1230>';

describe('a cage limit is named by a stable reason', () => {
  it('names fuel exhaustion', () => {
    assert.equal(limitReason(`wasm trap: all fuel consumed by WebAssembly: ${BACKTRACE}`), 'CAGE_FUEL_LIMIT');
  });

  it('names a refused memory growth, even when the backtrace comes first', () => {
    assert.equal(limitReason(`${BACKTRACE}: failed to grow memory by \`65536\``), 'CAGE_MEMORY_LIMIT');
    assert.equal(limitReason('InternalError: out of memory'), 'CAGE_MEMORY_LIMIT');
  });

  it('names nothing for any other failure', () => {
    assert.equal(limitReason(`wasm trap: unreachable: ${BACKTRACE}`), undefined);
    assert.equal(limitReason('guest exports no memory'), undefined);
  });
});
