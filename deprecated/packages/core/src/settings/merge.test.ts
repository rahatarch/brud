import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mergeSettings } from './merge';
import { DEFAULT_SETTINGS } from './types';

describe('Settings merge logic', () => {
  it('a) All defaults returns default settings', () => {
    const { settings, warnings } = mergeSettings({}, {}, {});
    assert.deepStrictEqual(settings, DEFAULT_SETTINGS);
    assert.strictEqual(warnings.length, 0);
  });

  it('b) VS Code global overrides default', () => {
    const { settings, warnings } = mergeSettings(
      { workspaceBoundaryEnabled: false },
      {},
      {},
    );
    assert.strictEqual(settings.workspaceBoundaryEnabled, false);
    assert.deepStrictEqual(settings.toolAllowList, DEFAULT_SETTINGS.toolAllowList);
    assert.strictEqual(warnings.length, 0);
  });

  it('c) VS Code workspace overrides global', () => {
    const { settings, warnings } = mergeSettings(
      { workspaceBoundaryEnabled: false },
      { workspaceBoundaryEnabled: true },
      {},
    );
    assert.strictEqual(settings.workspaceBoundaryEnabled, true);
    assert.strictEqual(warnings.length, 0);
  });

  it('d) .brud/settings.json overrides all', () => {
    const { settings, warnings } = mergeSettings(
      { workspaceBoundaryEnabled: false, toolAllowList: { create_file: false } },
      { workspaceBoundaryEnabled: true, toolAllowList: { delete_file: false } },
      { workspaceBoundaryEnabled: false, toolAllowList: { search_replace: false } },
    );
    assert.strictEqual(settings.workspaceBoundaryEnabled, false);
    assert.strictEqual(settings.toolAllowList.create_file, false);
    assert.strictEqual(settings.toolAllowList.search_replace, false);
    assert.strictEqual(settings.toolAllowList.delete_file, false);
    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0].includes('.brud/settings.json takes precedence'));
  });

  it('e) Warning fires when both workspace and .brud/settings.json present', () => {
    const { warnings } = mergeSettings({}, { workspaceBoundaryEnabled: false }, { workspaceBoundaryEnabled: true });
    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0].includes('.brud/settings.json takes precedence'));
  });

  it('f) Partial tool allow list merges correctly', () => {
    const { settings, warnings } = mergeSettings(
      { toolAllowList: { terminal_command: false } },
      {},
      { toolAllowList: { create_file: false } },
    );
    assert.strictEqual(settings.toolAllowList.terminal_command, false);
    assert.strictEqual(settings.toolAllowList.create_file, false);
    assert.strictEqual(warnings.length, 0);
  });

  it('g) Empty tool allow list means all tools enabled', () => {
    const { settings } = mergeSettings({}, {}, { toolAllowList: {} });
    assert.deepStrictEqual(settings.toolAllowList, {});
    assert.strictEqual(settings.toolAllowList['search_replace'], undefined);
  });

  it('Warning does not fire when only global and .brud/settings.json present', () => {
    const { warnings } = mergeSettings(
      { workspaceBoundaryEnabled: false },
      {},
      { workspaceBoundaryEnabled: true },
    );
    assert.strictEqual(warnings.length, 0);
  });
});