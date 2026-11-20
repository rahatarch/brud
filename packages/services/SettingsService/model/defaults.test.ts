import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  READ_CONCURRENCY_MAX,
  sanitizeSettingsDocument,
} from './defaults.js';

describe('sanitizeSettingsDocument', () => {
  it('returns defaults-compatible values for an empty document', () => {
    const result = sanitizeSettingsDocument({}, 'user');

    assert.deepEqual(result.values, {});
    assert.deepEqual(result.warnings, []);
  });

  it('reports invalid field types and drops them', () => {
    const result = sanitizeSettingsDocument(
      {
        workspaceBoundaryEnabled: 'yes',
        commandValidationEnabled: 1,
        toolAllowList: { create_file: 'no', delete_file: true },
        plugins: { 'brud.search': 'sometimes', 'brud.history': 'active' },
      },
      'workspace',
    );

    assert.equal(result.values.workspaceBoundaryEnabled, undefined);
    assert.equal(result.values.commandValidationEnabled, undefined);
    assert.deepEqual(result.values.toolAllowList, { delete_file: true });
    assert.deepEqual(result.values.plugins, { 'brud.history': 'active' });
    assert.equal(result.warnings.filter((warning) => warning.code === 'INVALID_FIELD').length, 4);
  });

  it('clamps numeric governors into safe ranges', () => {
    const result = sanitizeSettingsDocument(
      {
        readConcurrency: 999,
        readMaxBatchFiles: 0,
        readMaxAggregateBytes: -10,
      },
      'user',
    );

    assert.equal(result.values.readConcurrency, READ_CONCURRENCY_MAX);
    assert.equal(result.values.readMaxBatchFiles, 1);
    assert.equal(result.values.readMaxAggregateBytes, 1);
    assert.equal(result.warnings.filter((warning) => warning.code === 'VALUE_CLAMPED').length, 3);
  });

  it('never exposes unknown keys in the typed values', () => {
    const result = sanitizeSettingsDocument(
      { workspaceBoundaryEnabled: true, futureKey: 'ignored' },
      'user',
    );

    assert.deepEqual(Object.keys(result.values), ['workspaceBoundaryEnabled']);
  });

  it('rejects non-object documents', () => {
    const result = sanitizeSettingsDocument([], 'workspace');

    assert.deepEqual(result.values, {});
    assert.equal(result.warnings[0]?.code, 'INVALID_FIELD');
  });

  it('exposes frozen defaults', () => {
    assert.equal(Object.isFrozen(DEFAULT_SETTINGS), true);
    assert.equal(Object.isFrozen(DEFAULT_SETTINGS.toolAllowList), true);
    assert.equal(Object.isFrozen(DEFAULT_SETTINGS.plugins), true);
  });
});

describe('sanitizeSettingsDocument — history retention (D-15 U-8)', () => {
  it('parses retention integers and clamps them to the ceilings', () => {
    const result = sanitizeSettingsDocument({ historyRetentionDays: 9_999, historyMinUndoEntries: 12_345.7 }, 'user');

    assert.equal(result.values.historyRetentionDays, 3_650);
    assert.equal(result.values.historyMinUndoEntries, 12_345);
    assert.deepEqual(result.warnings.map((warning) => warning.code), ['VALUE_CLAMPED']);
  });

  it('rejects non-numeric retention values', () => {
    const result = sanitizeSettingsDocument({ historyRetentionDays: '90' }, 'workspace');

    assert.equal(result.values.historyRetentionDays, undefined);
    assert.deepEqual(result.warnings.map((warning) => warning.code), ['INVALID_FIELD']);
  });
});
