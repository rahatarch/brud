import { describe, it } from 'node:test';
import assert from 'node:assert';
import { detectFields, substituteFields } from './fields';

describe('detectFields', () => {
  it('a) returns [] for no fields', () => {
    assert.deepStrictEqual(detectFields('plain text without fields'), []);
  });

  it('b) returns unique field names', () => {
    const result = detectFields('${[name]} and ${[name]} again');
    assert.deepStrictEqual(result, ['name']);
  });

  it('c) trims whitespace', () => {
    const result = detectFields('${[  name  ]}');
    assert.deepStrictEqual(result, ['name']);
  });

  it('d) ignores empty ${[]}', () => {
    const result = detectFields('empty ${[]} field');
    assert.deepStrictEqual(result, []);
  });

  it('e) ignores non-matching brackets', () => {
    const result = detectFields('this is [INFO] and ${not_field} and normal text');
    assert.deepStrictEqual(result, []);
  });

  it('f) handles mixed content', () => {
    const result = detectFields('Hello ${[name]}, your ${[role]} is ready. ${[name]} again.');
    assert.deepStrictEqual(result, ['name', 'role']);
  });
});

describe('substituteFields', () => {
  it('g) replaces all occurrences', () => {
    const result = substituteFields('Hello ${[name]}! Your ${[role]} is set.', { name: 'Alice', role: 'admin' });
    assert.strictEqual(result, 'Hello Alice! Your admin is set.');
  });

  it('h) preserves unknown fields', () => {
    const result = substituteFields('Hello ${[name]} and ${[unknown]}', { name: 'Bob' });
    assert.strictEqual(result, 'Hello Bob and ${[unknown]}');
  });

  it('i) handles empty values', () => {
    const result = substituteFields('${[a]}${[b]}${[c]}', { a: '', b: 'mid', c: '' });
    assert.strictEqual(result, 'mid');
  });
});