import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applySingleMatch,
  findSingleMatch,
  stripNumericLinePrefixes,
} from './index.js';

describe('pure match helpers', () => {
  it('finds a single match', () => {
    const result = findSingleMatch('alpha beta gamma', 'beta');

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.index, 6);
    }
  });

  it('reports zero matches', () => {
    const result = findSingleMatch('alpha beta', 'missing');

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'SEARCH_NOT_FOUND');
    }
  });

  it('reports multiple matches', () => {
    const result = findSingleMatch('foo bar foo', 'foo');

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'MULTIPLE_MATCHES');
    }
  });

  it('applies the replacement exactly once', () => {
    const result = applySingleMatch('before TARGET after', 'TARGET', 'value');

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.content, 'before value after');
    }
  });

  it('strips numeric line prefixes', () => {
    assert.equal(
      stripNumericLinePrefixes('1 | alpha\n2 | beta\n  3 | gamma'),
      'alpha\nbeta\ngamma',
    );
  });
});