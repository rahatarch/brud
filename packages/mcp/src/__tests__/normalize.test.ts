import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import { globalToolRegistry, initializeToolRegistry } from '@brud/core';
import { getToolParameterNames, normalizeArguments } from '../normalize';

const ROOT = path.resolve('/workspace/project');

describe('MCP parameter normalization', () => {
  it('maps every documented tool: accepted parameter names match the tool registry', () => {
    initializeToolRegistry();
    const tools = globalToolRegistry.getAllTools();
    assert.ok(tools.length > 0);
    for (const tool of tools) {
      const names = getToolParameterNames(tool.kind);
      assert.ok(names, `no normalizer spec for documented tool ${tool.kind}`);
      const documented = tool.parameters.map((p) => p.name).sort();
      const accepted = [...(names as readonly string[])].sort();
      const undocumented = accepted.filter((name) => !documented.includes(name));
      const unmapped = documented.filter((name) => !accepted.includes(name));
      assert.deepStrictEqual(
        unmapped,
        [],
        `documented parameters without a mapping for ${tool.kind}: ${unmapped.join(', ')}`,
      );
      assert.deepStrictEqual(
        undocumented,
        [],
        `normalizer accepts parameters the tool does not document for ${tool.kind}: ${undocumented.join(', ')}`,
      );
    }
  });

  it('resolves file paths against the workspace root', () => {
    const result = normalizeArguments('read_file', { filePath: 'src/a.ts' }, ROOT);
    assert.strictEqual(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.strictEqual(result.input.path, path.resolve(ROOT, 'src/a.ts'));
    assert.strictEqual(result.input.kind, 'read_file');
    assert.strictEqual(result.input.index, '0');
  });

  it('keeps absolute paths absolute and applies read_file defaults', () => {
    const absolute = path.resolve('/elsewhere/b.txt');
    const result = normalizeArguments('read_file', { filePath: absolute }, ROOT);
    assert.strictEqual(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.strictEqual(result.input.path, absolute);
    assert.strictEqual(result.input.isImportRead, false);
    assert.strictEqual(result.input.maxDepth, 0);
  });

  it('splits multi-file patterns but preserves brace globs', () => {
    const result = normalizeArguments(
      'search_files',
      { pattern: '**/*.{ts,tsx}, *.md', exclude: 'dist,node_modules' },
      ROOT,
    );
    assert.strictEqual(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.deepStrictEqual(result.input.patterns, ['**/*.{ts,tsx}', '*.md']);
    assert.deepStrictEqual(result.input.excludePatterns, ['dist', 'node_modules']);
    assert.strictEqual(result.input.recursive, false);
    assert.strictEqual(result.input.maxResults, undefined);
  });

  it('resolves scope to an absolute search directory', () => {
    const result = normalizeArguments('read_files', { pattern: '**/*.ts', scope: 'src' }, ROOT);
    assert.strictEqual(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.strictEqual(result.input.directory, path.resolve(ROOT, 'src'));
    assert.strictEqual(result.input.maxDepth, 0);
    assert.strictEqual(result.input.isImportRead, false);
  });

  it('wraps a single import syntax string without splitting it', () => {
    const result = normalizeArguments(
      'read_file',
      { filePath: 'a.ts', importSyntax: 'import\\s+.*from' },
      ROOT,
    );
    assert.strictEqual(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.deepStrictEqual(result.input.importSyntax, ['import\\s+.*from']);
  });

  it('maps terminal names and builds command groups', () => {
    const result = normalizeArguments(
      'terminal_command',
      { command: 'npm test', onFailure: 'npm run lint' },
      ROOT,
    );
    assert.strictEqual(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.strictEqual(result.input.stopOnFailure, true);
    assert.strictEqual(result.input.timeout, 120);
    assert.deepStrictEqual(result.input.onFailure, {
      type: 'sequential',
      commands: ['npm run lint'],
    });
  });

  it('rejects unknown parameters instead of dropping them', () => {
    const result = normalizeArguments('read_file', { filePath: 'a.ts', pattern: '*.ts' }, ROOT);
    assert.strictEqual(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.strictEqual(result.code, 'UNKNOWN_PARAMETER');
  });

  it('rejects client-supplied kind or index', () => {
    const kind = normalizeArguments('read_file', { filePath: 'a.ts', kind: 'delete_file' }, ROOT);
    assert.strictEqual(kind.ok, false);
    const index = normalizeArguments('read_file', { filePath: 'a.ts', index: '9' }, ROOT);
    assert.strictEqual(index.ok, false);
  });

  it('rejects wrong types without coercing', () => {
    const result = normalizeArguments('read_file', { filePath: 'a.ts', startLine: '10' }, ROOT);
    assert.strictEqual(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.strictEqual(result.code, 'INVALID_TYPE');
  });

  it('rejects missing required parameters', () => {
    const result = normalizeArguments('create_file', { path: 'a.ts' }, ROOT);
    assert.strictEqual(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.strictEqual(result.code, 'MISSING_PARAMETER');
  });

  it('rejects unknown tool kinds', () => {
    const result = normalizeArguments('get_tool_info', {}, ROOT);
    assert.strictEqual(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.strictEqual(result.code, 'UNKNOWN_TOOL');
  });
});
