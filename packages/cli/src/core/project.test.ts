import assert from 'node:assert/strict';
import { test } from 'node:test';
import { satisfies } from './project.js';

test('satisfies handles the caret and >= ranges Brud packages publish', () => {
  assert.equal(satisfies('0.1.4', '^0.1.4'), true);
  assert.equal(satisfies('0.1.9', '^0.1.4'), true);
  assert.equal(satisfies('0.2.0', '^0.1.4'), false);
  assert.equal(satisfies('0.1.3', '^0.1.4'), false);
  assert.equal(satisfies('1.4.0', '^1.2.0'), true);
  assert.equal(satisfies('2.0.0', '^1.2.0'), false);
  assert.equal(satisfies('22.23.4', '>=22'), true);
  assert.equal(satisfies('20.1.0', '>=22'), false);
});
