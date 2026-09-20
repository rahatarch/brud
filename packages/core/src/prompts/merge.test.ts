import { describe, it } from 'node:test';
import assert from 'node:assert';
import { cascadePrompts } from './merge';
import type { UserPrompt } from './types';

function makePrompt(id: string, scope: 'global' | 'workspace'): UserPrompt {
  return {
    id,
    title: `Prompt ${id}`,
    description: '',
    tags: [],
    createdAt: '',
    updatedAt: '',
    currentVersion: 1,
    scope,
    versions: [{ version: 1, content: '', timestamp: '', message: '' }],
  };
}

describe('cascadePrompts', () => {
  it('a) Global only returns global', () => {
    const global = [makePrompt('a', 'global')];
    const result = cascadePrompts(global, []);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 'a');
    assert.strictEqual(result[0].scope, 'global');
  });

  it('b) Workspace only returns workspace', () => {
    const workspace = [makePrompt('b', 'workspace')];
    const result = cascadePrompts([], workspace);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 'b');
    assert.strictEqual(result[0].scope, 'workspace');
  });

  it('c) Both with no overlap returns union', () => {
    const global = [makePrompt('a', 'global'), makePrompt('b', 'global')];
    const workspace = [makePrompt('c', 'workspace'), makePrompt('d', 'workspace')];
    const result = cascadePrompts(global, workspace);
    assert.strictEqual(result.length, 4);
    const ids = result.map(p => p.id).sort();
    assert.deepStrictEqual(ids, ['a', 'b', 'c', 'd']);
  });

  it('d) Both with overlap workspace wins', () => {
    const global = [makePrompt('x', 'global')];
    const workspace = [makePrompt('x', 'workspace')];
    const result = cascadePrompts(global, workspace);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 'x');
    assert.strictEqual(result[0].scope, 'workspace');
  });

  it('e) Empty inputs returns empty', () => {
    const result = cascadePrompts([], []);
    assert.deepStrictEqual(result, []);
  });
});