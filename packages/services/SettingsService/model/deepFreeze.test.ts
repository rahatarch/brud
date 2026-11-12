import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deepFreeze } from './deepFreeze.js';

describe('deepFreeze', () => {
  it('freezes nested objects and arrays', () => {
    const value = {
      top: 'value',
      nested: { enabled: true },
      list: [{ mode: 'shadow' }],
    };

    const frozen = deepFreeze(value);

    assert.equal(frozen, value);
    assert.equal(Object.isFrozen(value), true);
    assert.equal(Object.isFrozen(value.nested), true);
    assert.equal(Object.isFrozen(value.list), true);
    assert.equal(Object.isFrozen(value.list[0]), true);
  });

  it('returns primitives unchanged', () => {
    assert.equal(deepFreeze(42), 42);
    assert.equal(deepFreeze('text'), 'text');
    assert.equal(deepFreeze(null), null);
  });

  it('throws on nested mutation in strict mode', () => {
    const value = deepFreeze({ nested: { count: 1 } });

    assert.throws(() => {
      const mutable: { count: number } = value.nested;
      mutable.count = 2;
    }, TypeError);
  });
});
