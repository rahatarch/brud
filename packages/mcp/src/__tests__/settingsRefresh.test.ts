import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { bootMcpWorkspace } from '../bootstrap';

describe('live settings refresh', () => {
  it('applies an edited settings file to the next execution without restarting', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-refresh-'));
    fs.mkdirSync(path.join(root, '.brud'), { recursive: true });
    const settingsPath = path.join(root, '.brud', 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ workspaceBoundaryEnabled: true }));

    const outside = path.join(path.dirname(root), `outside-${path.basename(root)}.txt`);
    fs.writeFileSync(outside, 'secret');

    const workspace = await bootMcpWorkspace(root);
    const probe = () =>
      workspace.kernel.execute('read_file', { path: outside }, { workspaceRoot: workspace.workspaceRoot });

    assert.strictEqual((await probe()).status, 'failed');
    assert.strictEqual(workspace.settings.workspaceBoundaryEnabled, true);

    fs.writeFileSync(settingsPath, JSON.stringify({ workspaceBoundaryEnabled: false }));
    workspace.refreshSettings();

    assert.strictEqual(workspace.settings.workspaceBoundaryEnabled, false);
    assert.strictEqual((await probe()).status, 'success');

    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
  });

  it('keeps the settings object identity so the kernel sees updates', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-refresh-id-'));
    fs.mkdirSync(path.join(root, '.brud'), { recursive: true });
    fs.writeFileSync(path.join(root, '.brud', 'settings.json'), JSON.stringify({ toolAllowList: { read_file: true } }));
    const workspace = await bootMcpWorkspace(root);
    const reference = workspace.settings;
    workspace.refreshSettings();
    assert.strictEqual(workspace.settings, reference);
    assert.strictEqual(reference.toolAllowList.read_file, true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
