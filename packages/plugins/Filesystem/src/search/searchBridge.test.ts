import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OperationResult } from '@brud/kernel';
import {
  MAX_PATTERN_LENGTH,
  resolveSearchFiles,
} from './index.js';

describe('search bridge', () => {
  it('translates pattern, scope, and exclude into search_files', async () => {
    const calls: Array<{ name: string; input: unknown }> = [];
    const execute = async (name: string, input: unknown): Promise<OperationResult> => {
      calls.push({ name, input });

      return {
        status: 'success',
        data: { results: [{ path: 'src/b.ts' }, { path: 'src/a.ts' }] },
      };
    };

    const paths = await resolveSearchFiles(execute, {
      pattern: '**/*.ts',
      scope: 'src',
      exclude: ['node_modules'],
    });

    assert.deepEqual(calls, [{
      name: 'search_files',
      input: {
        patterns: ['**/*.ts'],
        directory: 'src',
        excludePatterns: ['node_modules'],
      },
    }]);
    assert.deepEqual(paths, ['src/a.ts', 'src/b.ts']);
  });

  it('omits absent optional fields', async () => {
    let payload: unknown;
    const execute = async (_name: string, input: unknown): Promise<OperationResult> => {
      payload = input;

      return { status: 'success', data: { results: [] } };
    };

    await resolveSearchFiles(execute, { pattern: '*.ts' });

    assert.deepEqual(payload, { patterns: ['*.ts'] });
  });

  it('returns SEARCH_FAILED when the Search plugin is missing', async () => {
    const execute = async (): Promise<OperationResult> => ({
      status: 'failed',
      error: 'TOOL_NOT_FOUND: Tool "search_files" is not registered',
    });

    await assert.rejects(
      () => resolveSearchFiles(execute, { pattern: '*.ts' }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'SEARCH_FAILED');

        return true;
      },
    );
  });

  it('returns SEARCH_FAILED when search throws', async () => {
    const execute = async (): Promise<OperationResult> => {
      throw new Error('transport exploded');
    };

    await assert.rejects(
      () => resolveSearchFiles(execute, { pattern: '*.ts' }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'SEARCH_FAILED');

        return true;
      },
    );
  });

  it('rejects pathological glob patterns before dispatch', async () => {
    const execute = async (): Promise<OperationResult> => ({
      status: 'success',
      data: { results: [] },
    });

    await assert.rejects(
      () => resolveSearchFiles(execute, { pattern: '*'.repeat(MAX_PATTERN_LENGTH + 1) }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'VALIDATION_ERROR');

        return true;
      },
    );
  });
});