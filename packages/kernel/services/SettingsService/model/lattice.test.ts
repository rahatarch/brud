import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from './defaults.js';
import {
  applyLatticeToWorkspacePatch,
  evaluateLattice,
  meetRollout,
} from './lattice.js';

describe('evaluateLattice', () => {
  it('returns the ratified defaults when every layer is empty', () => {
    const { snapshot, warnings } = evaluateLattice();

    assert.deepEqual(snapshot, DEFAULT_SETTINGS);
    assert.deepEqual(warnings, []);
  });

  it('ignores a workspace attempt to disable the workspace boundary', () => {
    const { snapshot, warnings } = evaluateLattice({
      workspace: { workspaceBoundaryEnabled: false },
    });

    assert.equal(snapshot.workspaceBoundaryEnabled, true);

    const warning = warnings.find((entry) => entry.field === 'workspaceBoundaryEnabled');

    assert.ok(warning !== undefined);
    assert.equal(warning.code, 'SAFETY_LOOSENING_IGNORED');
    assert.equal(warning.scope, 'workspace');
    assert.match(warning.message, /SAFETY_LOOSENING_IGNORED:workspaceBoundaryEnabled/u);
    assert.equal(warning.message.includes('/'), false);
  });

  it('ignores a workspace attempt to disable command validation', () => {
    const { snapshot, warnings } = evaluateLattice({
      workspace: { commandValidationEnabled: false },
    });

    assert.equal(snapshot.commandValidationEnabled, true);
    assert.equal(
      warnings.filter((entry) => entry.code === 'SAFETY_LOOSENING_IGNORED').length,
      1,
    );
  });

  it('lets the trusted user scope relax a safety policy', () => {
    const { snapshot, warnings } = evaluateLattice({
      user: { workspaceBoundaryEnabled: false },
    });

    assert.equal(snapshot.workspaceBoundaryEnabled, false);
    assert.deepEqual(warnings, []);
  });

  it('lets workspace scope tighten a policy the user relaxed', () => {
    const { snapshot, warnings } = evaluateLattice({
      user: { workspaceBoundaryEnabled: false },
      workspace: { workspaceBoundaryEnabled: true },
    });

    assert.equal(snapshot.workspaceBoundaryEnabled, true);
    assert.deepEqual(warnings, []);
  });

  it('meets plugin rollout levels so workspace cannot escalate', () => {
    const { snapshot, warnings } = evaluateLattice({
      user: { plugins: { 'brud.terminal': 'off', 'brud.search': 'shadow' } },
      workspace: {
        plugins: {
          'brud.terminal': 'active',
          'brud.search': 'active',
          'brud.history': 'active',
        },
      },
    });

    assert.equal(snapshot.plugins['brud.terminal'], 'off');
    assert.equal(snapshot.plugins['brud.search'], 'shadow');
    assert.equal(snapshot.plugins['brud.history'], 'active');

    const terminalWarning = warnings.find((entry) => entry.field === 'plugins.brud.terminal');

    assert.ok(terminalWarning !== undefined);
    assert.equal(terminalWarning.code, 'SAFETY_LOOSENING_IGNORED');
    assert.match(terminalWarning.message, /SAFETY_LOOSENING_IGNORED:plugins\.brud\.terminal/u);

    const searchWarning = warnings.find((entry) => entry.field === 'plugins.brud.search');

    assert.ok(searchWarning !== undefined);
  });

  it('meets the tool allow list with logical AND', () => {
    const { snapshot, warnings } = evaluateLattice({
      user: { toolAllowList: { terminal_command: false, create_file: false } },
      workspace: { toolAllowList: { terminal_command: true, read_file: true } },
    });

    assert.equal(snapshot.toolAllowList.terminal_command, false);
    assert.equal(snapshot.toolAllowList.create_file, false);
    assert.equal(snapshot.toolAllowList.read_file, true);

    const warning = warnings.find(
      (entry) => entry.field === 'toolAllowList.terminal_command',
    );

    assert.ok(warning !== undefined);
    assert.match(warning.message, /SAFETY_LOOSENING_IGNORED:toolAllowList\.terminal_command/u);
  });

  it('meets read governors with the smallest layer value', () => {
    const { snapshot } = evaluateLattice({
      user: { readConcurrency: 8, readMaxBatchFiles: 40, readMaxAggregateBytes: 1000 },
      workspace: { readConcurrency: 16, readMaxBatchFiles: 20, readMaxAggregateBytes: 4000 },
    });

    assert.equal(snapshot.readConcurrency, 8);
    assert.equal(snapshot.readMaxBatchFiles, 20);
    assert.equal(snapshot.readMaxAggregateBytes, 1000);
  });

  it('clamps numeric governors into the ratified ranges after meeting', () => {
    const { snapshot } = evaluateLattice({
      user: { readConcurrency: 500 },
      workspace: { readMaxBatchFiles: -1 },
    });

    assert.equal(snapshot.readConcurrency, 32);
    assert.equal(snapshot.readMaxBatchFiles, 1);
  });

  it('merges map keys without leaking defaults into unrelated layers', () => {
    const { snapshot } = evaluateLattice({
      user: {
        toolAllowList: { create_file: false },
        plugins: { 'brud.search': 'shadow' },
        readConcurrency: 4,
      },
      workspace: {
        toolAllowList: { delete_file: false },
        plugins: { 'brud.history': 'active' },
      },
    });

    assert.deepEqual(snapshot.toolAllowList, {
      create_file: false,
      delete_file: false,
    });
    assert.deepEqual(snapshot.plugins, {
      'brud.search': 'shadow',
      'brud.history': 'active',
    });
    assert.equal(snapshot.readConcurrency, 4);
  });
});

describe('meetRollout', () => {
  it('orders off < shadow < active', () => {
    assert.equal(meetRollout('active', 'shadow'), 'shadow');
    assert.equal(meetRollout('shadow', 'off'), 'off');
    assert.equal(meetRollout('active', 'off'), 'off');
    assert.equal(meetRollout('active', 'active'), 'active');
    assert.equal(meetRollout('shadow', 'shadow'), 'shadow');
  });
});

describe('applyLatticeToWorkspacePatch', () => {
  it('removes unsafe relaxations before a workspace write', () => {
    const result = applyLatticeToWorkspacePatch(
      {
        workspaceBoundaryEnabled: false,
        commandValidationEnabled: true,
        readConcurrency: 8,
      },
      { user: { workspaceBoundaryEnabled: true } },
    );

    assert.equal(result.patch.workspaceBoundaryEnabled, undefined);
    assert.equal(result.patch.commandValidationEnabled, true);
    assert.equal(result.patch.readConcurrency, 8);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0]?.code, 'SAFETY_LOOSENING_IGNORED');
  });

  it('allows a workspace patch to tighten safety', () => {
    const result = applyLatticeToWorkspacePatch(
      { commandValidationEnabled: true },
      { user: { commandValidationEnabled: false } },
    );

    assert.equal(result.patch.commandValidationEnabled, true);
    assert.deepEqual(result.warnings, []);
  });

  it('drops a plugin escalation the user scope forbids', () => {
    const result = applyLatticeToWorkspacePatch(
      { plugins: { 'brud.terminal': 'active', 'brud.history': 'shadow' } },
      { user: { plugins: { 'brud.terminal': 'off' } } },
    );

    assert.deepEqual(result.patch.plugins, { 'brud.history': 'shadow' });
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0]?.field, 'plugins.brud.terminal');
    assert.match(result.warnings[0]?.message ?? '', /SAFETY_LOOSENING_IGNORED:plugins\.brud\.terminal/u);
  });

  it('drops a tool allowlist relaxation the user scope forbids', () => {
    const result = applyLatticeToWorkspacePatch(
      { toolAllowList: { delete_file: true, read_file: true } },
      { user: { toolAllowList: { delete_file: false } } },
    );

    assert.deepEqual(result.patch.toolAllowList, { read_file: true });
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0]?.field, 'toolAllowList.delete_file');
  });

  it('removes map patches that contain only rejected entries', () => {
    const result = applyLatticeToWorkspacePatch(
      { plugins: { 'brud.terminal': 'active' } },
      { user: { plugins: { 'brud.terminal': 'off' } } },
    );

    assert.equal(result.patch.plugins, undefined);
    assert.equal(result.warnings.length, 1);
  });

  it('keeps a workspace plugin downgrade', () => {
    const result = applyLatticeToWorkspacePatch(
      { plugins: { 'brud.search': 'off' } },
      { user: { plugins: { 'brud.search': 'active' } } },
    );

    assert.deepEqual(result.patch.plugins, { 'brud.search': 'off' });
    assert.deepEqual(result.warnings, []);
  });
});
