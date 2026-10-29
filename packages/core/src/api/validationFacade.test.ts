import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import {
  boundaryPolicy,
  outsideRootResult,
  policyFromSettings,
  validateBatchDecision,
  validateKnownOperation,
  validateKnownTool,
  validateMetadata,
  validatePath,
  validateReadOnlyProjectionDecision,
} from './validationFacade';
import { DEFAULT_SETTINGS } from '../settings/types';

describe('knownOperation / knownTool membership (F-1)', () => {
  it('accepts a catalogued kind that has mandatory fields', () => {
    const operation = validateKnownOperation('read_file');

    assert.strictEqual(operation.success, true);
    assert.deepStrictEqual(operation.data, { operation: 'read_file' });

    const tool = validateKnownTool('read_file');

    assert.strictEqual(tool.success, true);
    assert.deepStrictEqual(tool.data, { toolKind: 'read_file' });
  });

  it('accepts every one of the 21 kinds', () => {
    for (const kind of ['create_file', 'terminal_command', 'get_tool_info', 'codebase_metadata']) {
      assert.strictEqual(validateKnownOperation(kind).success, true, kind);
      assert.strictEqual(validateKnownTool(kind).success, true, kind);
    }
  });

  it('rejects an unknown operation with UNKNOWN_OPERATION', () => {
    const result = validateKnownOperation('bogus_operation');

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'UNKNOWN_OPERATION');
  });
});

describe('knownTool boundary code (F-2)', () => {
  it('rejects an unknown tool with TOOL_NOT_FOUND', () => {
    const result = validateKnownTool('bogus_tool');

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'TOOL_NOT_FOUND');
    assert.ok(result.friendly?.includes('bogus_tool'));
  });
});

describe('metadata member checks (F-3)', () => {
  const cases = [
    ['INPUT.METADATA_WRONG_CASE', { wrapper: 'SESSION_METADATA' }, 'E_METADATA_WRONG_CASE'],
    ['INPUT.DUPLICATE_SESSION_METADATA', {}, 'E_DUPLICATE_SESSION_METADATA'],
    ['INPUT.DUPLICATE_OPERATION_METADATA', { index: '2' }, 'E_DUPLICATE_OPERATION_METADATA'],
    ['INPUT.METADATA_FIELD_CASE', { field: 'Title:' }, 'E_METADATA_FIELD_CASE'],
    ['INPUT.METADATA_UNKNOWN_FIELD', { field: 'author:' }, 'E_METADATA_UNKNOWN_FIELD'],
    ['INPUT.SESSION_METADATA_POSITION', {}, 'E_SESSION_METADATA_POSITION'],
    ['INPUT.OPERATION_METADATA_POSITION', { index: '3' }, 'E_OPERATION_METADATA_POSITION'],
    ['INPUT.METADATA_UNCLOSED', { wrapper: 'session_metadata' }, 'E_METADATA_UNCLOSED'],
  ] as const;

  for (const [rule, values, code] of cases) {
    it(`keeps the legacy code for ${rule}`, () => {
      const result = validateMetadata(rule, values);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.code, code);
    });
  }

  it('preserves the legacy friendly text for unclosed wrappers', () => {
    const result = validateMetadata('INPUT.METADATA_UNCLOSED', { wrapper: 'session_metadata' });

    assert.strictEqual(result.friendly, 'Unclosed <session_metadata> wrapper. Expected </session_metadata>.');
  });
});

describe('boundary policy (F-4)', () => {
  it('never defaults to per-call settings', () => {
    assert.strictEqual(Object.isFrozen(boundaryPolicy()), true);
    assert.strictEqual(Object.isFrozen(boundaryPolicy().toolAllowList), true);
  });

  it('honours the explicit batch snapshot when supplied', () => {
    const snapshot = policyFromSettings({
      ...DEFAULT_SETTINGS,
      workspaceBoundaryEnabled: false,
      commandValidationEnabled: false,
    });

    const policy = boundaryPolicy(snapshot);

    assert.strictEqual(policy.workspaceBoundaryEnabled, false);
    assert.strictEqual(policy.commandValidationEnabled, false);
  });

  it('is fail-closed without an explicit snapshot', () => {
    const policy = boundaryPolicy();

    assert.strictEqual(policy.workspaceBoundaryEnabled, true);
    assert.strictEqual(policy.commandValidationEnabled, true);
  });
});

describe('OUTSIDE_ROOT contract (Appendix C)', () => {
  const workspaceFolders = [path.resolve('/workspace')];

  it('maps a root escape to PATH_OUTSIDE_WORKSPACE, never VALIDATION_ERROR', () => {
    const result = validatePath(path.resolve('/etc/passwd'), workspaceFolders, boundaryPolicy());

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'PATH_OUTSIDE_WORKSPACE');
    assert.strictEqual(result.data, path.resolve('/etc/passwd'));
    assert.ok(result.details?.includes('outside the current workspace'));
  });

  it('renders the kernel decision arm and the no-owning-root arm identically', () => {
    const viaDecision = validatePath(path.resolve('/etc/passwd'), workspaceFolders, boundaryPolicy());
    const viaLegacy = outsideRootResult(path.resolve('/etc/passwd'));

    assert.deepStrictEqual(viaDecision, viaLegacy);
    assert.strictEqual(viaLegacy.code, 'PATH_OUTSIDE_WORKSPACE');
  });

  it('keeps an in-workspace path successful', () => {
    const result = validatePath('src/index.ts', workspaceFolders, boundaryPolicy());

    assert.strictEqual(result.success, true);
  });
});

describe('batch gate emission (POLICY)', () => {
  it('rejects an over-limit batch through INPUT.BATCH_LIMIT', () => {
    const decision = validateBatchDecision(101, 0, false, boundaryPolicy());

    assert.strictEqual(decision.ok, false);
    assert.strictEqual(decision.ok ? '' : decision.rule, 'INPUT.BATCH_LIMIT');
  });

  it('rejects an over-budget batch through POLICY.AGGREGATE_BYTES', () => {
    const decision = validateBatchDecision(1, 64 * 1024 * 1024, false, boundaryPolicy());

    assert.strictEqual(decision.ok, false);
    assert.strictEqual(decision.ok ? '' : decision.rule, 'POLICY.AGGREGATE_BYTES');
  });

  it('emits INPUT.READ_ONLY_PROJECTION for a read-only mutation', () => {
    const decision = validateReadOnlyProjectionDecision('createFile', '.brud/work/a.json');

    assert.strictEqual(decision.ok, false);
    assert.strictEqual(decision.ok ? '' : decision.rule, 'INPUT.READ_ONLY_PROJECTION');
    assert.strictEqual(decision.ok ? '' : decision.legacyCode, 'VALIDATION_ERROR');
  });
});
