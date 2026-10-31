import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ValidationPolicy } from '../contracts/IValidationService.js';
import { PolicyGateEngine, freezeValidationPolicy, GOVERNOR_BOUNDS } from '../engine/PolicyGateEngine.js';
import {
  READ_CONCURRENCY_MAX,
  READ_MAX_AGGREGATE_BYTES_MAX,
  READ_MAX_BATCH_FILES_MAX,
} from '../../SettingsService/model/defaults.js';
import { toValidationPolicy } from '../descriptor/ValidationDescriptor.js';
import type { SettingsSnapshot } from '../../SettingsService/contracts/ISettingsService.js';

function policy(overrides?: Partial<ValidationPolicy>): ValidationPolicy {
  return {
    workspaceBoundaryEnabled: true,
    commandValidationEnabled: true,
    toolAllowList: {},
    readConcurrency: 16,
    readMaxBatchFiles: 100,
    readMaxAggregateBytes: 8 * 1024 * 1024,
    schemaVersion: 1,
    ...overrides,
  };
}

describe('PolicyGateEngine — frozen ingestion', () => {
  it('deep-freezes the policy it is constructed with', () => {
    const gate = new PolicyGateEngine(policy({ toolAllowList: { create_file: false } }));

    assert.equal(Object.isFrozen(gate.policy), true);
    assert.equal(Object.isFrozen(gate.policy.toolAllowList), true);
    assert.throws(() => {
      (gate.policy as { workspaceBoundaryEnabled: boolean }).workspaceBoundaryEnabled = false;
    }, TypeError);
  });

  it('copies the allowlist so later caller mutation cannot weaken policy', () => {
    const source = policy({ toolAllowList: { create_file: false } });
    const gate = new PolicyGateEngine(source);

    (source.toolAllowList as Record<string, boolean>)['delete_file'] = false;

    assert.equal(gate.isToolEnabled('delete_file'), true);
    assert.equal(gate.isToolEnabled('create_file'), false);
  });

  it('exposes the frozen safety switches', () => {
    const gate = new PolicyGateEngine(policy({ workspaceBoundaryEnabled: false, commandValidationEnabled: true }));

    assert.equal(gate.workspaceBoundaryEnabled, false);
    assert.equal(gate.commandValidationEnabled, true);
  });

  it('clamps governors into the ratified ranges (POLICY.VALUE_CLAMPED)', () => {
    const frozen = freezeValidationPolicy(policy({
      readConcurrency: 999,
      readMaxBatchFiles: 0,
      readMaxAggregateBytes: READ_MAX_AGGREGATE_BYTES_MAX * 10,
    }));

    assert.equal(frozen.readConcurrency, READ_CONCURRENCY_MAX);
    assert.equal(frozen.readMaxBatchFiles, 1);
    assert.equal(frozen.readMaxAggregateBytes, READ_MAX_AGGREGATE_BYTES_MAX);
  });

  it('publishes the same ceilings the settings service ratified (R-6)', () => {
    assert.equal(GOVERNOR_BOUNDS.readMaxBatchFiles.max, READ_MAX_BATCH_FILES_MAX);
    assert.equal(GOVERNOR_BOUNDS.readMaxAggregateBytes.max, READ_MAX_AGGREGATE_BYTES_MAX);
    assert.equal(GOVERNOR_BOUNDS.readConcurrency.max, READ_CONCURRENCY_MAX);
    assert.equal(READ_MAX_BATCH_FILES_MAX, 100);
  });

  it('treats a non-finite governor as its ceiling', () => {
    const frozen = freezeValidationPolicy(policy({ readConcurrency: Number.NaN }));

    assert.equal(frozen.readConcurrency, READ_CONCURRENCY_MAX);
  });

  it('drops non-boolean allowlist entries', () => {
    const frozen = freezeValidationPolicy(policy({
      toolAllowList: { create_file: false, delete_file: 'yes' as unknown as boolean },
    }));

    assert.deepEqual(frozen.toolAllowList, { create_file: false });
  });

  it('absorbs the settings snapshot and drops plugin rollout', () => {
    const snapshot: SettingsSnapshot = {
      schemaVersion: 1,
      workspaceBoundaryEnabled: true,
      commandValidationEnabled: false,
      toolAllowList: { read_file: false },
      readConcurrency: 8,
      readMaxBatchFiles: 50,
      readMaxAggregateBytes: 1024,
      plugins: { 'x.plugin': 'active' },
      historyRetentionDays: 90,
      historyMinUndoEntries: 10_000,
    };

    const ingested = toValidationPolicy(snapshot);

    assert.equal(ingested.commandValidationEnabled, false);
    assert.equal(ingested.readMaxBatchFiles, 50);
    assert.equal(Object.prototype.hasOwnProperty.call(ingested, 'plugins'), false);
    assert.equal(Object.isFrozen(ingested), true);
  });

  it('cannot be weakened mid-session: there is no mutator', () => {
    const gate = new PolicyGateEngine(policy());
    const surface = gate as unknown as Record<string, unknown>;

    assert.equal(typeof surface['setPolicy'], 'undefined');
    assert.equal(typeof surface['reload'], 'undefined');
    assert.equal(typeof surface['onChange'], 'undefined');
  });
});

describe('PolicyGateEngine — per-call override rejection (POLICY.PER_CALL_OVERRIDE)', () => {
  const gate = new PolicyGateEngine(policy());

  it('rejects every legacy bypass flag', () => {
    for (const key of ['skipValidation', 'override', 'workspaceBoundaryEnabled', 'commandValidationEnabled', 'trustedScopes']) {
      const rejection = gate.rejectPerCallOverride({ [key]: key === 'trustedScopes' ? ['x'] : false });

      assert.notEqual(rejection, null, key);
      assert.equal(rejection?.option, key);
      assert.equal(rejection?.rule, 'POLICY.PER_CALL_OVERRIDE');
    }
  });

  it('accepts options that carry no policy', () => {
    assert.equal(gate.rejectPerCallOverride({ operationKind: 'read_file' }), null);
    assert.equal(gate.rejectPerCallOverride(undefined), null);
    assert.equal(gate.rejectPerCallOverride(null), null);
    assert.equal(gate.rejectPerCallOverride({ skipValidation: undefined }), null);
  });
});

describe('PolicyGateEngine — governor helpers', () => {
  const gate = new PolicyGateEngine(policy({ readMaxAggregateBytes: 100 }));

  it('clamps requested concurrency', () => {
    assert.equal(gate.clampConcurrency(0), 1);
    assert.equal(gate.clampConcurrency(8), 8);
    assert.equal(gate.clampConcurrency(1000), READ_CONCURRENCY_MAX);
  });

  it('admit checks the aggregate byte budget', () => {
    assert.equal(gate.admitsAggregateBytes(60, 40), true);
    assert.equal(gate.admitsAggregateBytes(60, 41), false);
  });

  it('exposes the frozen ceilings', () => {
    assert.equal(gate.readMaxBatchFiles, 100);
    assert.equal(gate.readMaxAggregateBytes, 100);
  });
});
