import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { BrudKernel } from '@brud/kernel' with { 'resolution-mode': 'import' };
import { bootMcpWorkspace } from '../bootstrap';
import { dispatchToolCall, sanitizeText } from '../dispatch';

function stubKernel(execute: () => Promise<unknown>): BrudKernel {
  return { execute } as unknown as BrudKernel;
}

describe('MCP dispatcher', () => {
  let root: string;
  let workspace: Awaited<ReturnType<typeof bootMcpWorkspace>>;

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-dispatch-'));
    fs.writeFileSync(path.join(root, 'a.txt'), 'alpha');
    fs.mkdirSync(path.join(root, '.brud'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.brud', 'settings.json'),
      JSON.stringify({ workspaceBoundaryEnabled: true, commandValidationEnabled: true }),
    );
    workspace = await bootMcpWorkspace(root);
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('executes a successful call and returns plain content', async () => {
    const result = await dispatchToolCall(
      workspace.kernel,
      'read_file',
      { filePath: 'a.txt' },
      { workspaceRoot: workspace.workspaceRoot },
    );
    assert.strictEqual(result.isError, false);
    assert.ok(result.content[0].text.includes('alpha'));
  });

  it('performs a mutation and records history', async () => {
    const result = await dispatchToolCall(
      workspace.kernel,
      'create_file',
      { path: 'b.txt', content: 'beta' },
      { workspaceRoot: workspace.workspaceRoot },
    );
    assert.strictEqual(result.isError, false);
    assert.ok(fs.existsSync(path.join(root, 'b.txt')));
    const sessions = fs.readdirSync(path.join(root, '.brud', 'history', 'sessions'));
    assert.ok(sessions.length > 0);
  });

  it('reports a boundary violation as an error with no absolute workspace path', async () => {
    const result = await dispatchToolCall(
      workspace.kernel,
      'read_file',
      { filePath: '../outside.txt' },
      { workspaceRoot: workspace.workspaceRoot },
    );
    assert.strictEqual(result.isError, true);
    assert.strictEqual(result.code, 'EXECUTION_FAILED');
    const text = result.content[0].text;
    assert.ok(text.length > 0);
    assert.ok(!text.includes(workspace.workspaceRoot), 'error leaked workspace path');
  });

  it('refuses invalid arguments before reaching the kernel', async () => {
    let called = false;
    const kernel = stubKernel(async () => {
      called = true;
      return { status: 'success' };
    });
    const result = await dispatchToolCall(
      kernel,
      'read_file',
      { filePath: 'a.txt', surprise: true },
      { workspaceRoot: root },
    );
    assert.strictEqual(result.isError, true);
    assert.strictEqual(result.code, 'UNKNOWN_PARAMETER');
    assert.strictEqual(called, false);
  });

  it('refuses unknown tools', async () => {
    const result = await dispatchToolCall(workspace.kernel, 'get_tool_info', {}, { workspaceRoot: root });
    assert.strictEqual(result.isError, true);
    assert.strictEqual(result.code, 'UNKNOWN_TOOL');
  });

  it('maps non-success kernel statuses to errors', async () => {
    for (const status of ['failed', 'aborted', 'skipped']) {
      const kernel = stubKernel(async () => ({ status, message: `status ${status}` }));
      const result = await dispatchToolCall(kernel, 'read_file', { filePath: 'a.txt' }, { workspaceRoot: root });
      assert.strictEqual(result.isError, true, status);
      assert.strictEqual(result.code, 'EXECUTION_FAILED', status);
    }
  });

  it('never leaks a stack trace when the kernel throws', async () => {
    const kernel = stubKernel(async () => {
      throw new Error('boom\n    at secretFunction (/internal/path/file.js:1:1)');
    });
    const result = await dispatchToolCall(kernel, 'read_file', { filePath: 'a.txt' }, { workspaceRoot: root });
    assert.strictEqual(result.isError, true);
    assert.strictEqual(result.code, 'INTERNAL_ERROR');
    const text = result.content[0].text;
    assert.ok(!text.includes('boom'));
    assert.ok(!text.includes('secretFunction'));
    assert.ok(!text.includes('/internal/path'));
    assert.match(text, /Reference: MCP-/);
  });

  it('treats a malformed kernel result as an internal error', async () => {
    const kernel = stubKernel(async () => undefined);
    const result = await dispatchToolCall(kernel, 'read_file', { filePath: 'a.txt' }, { workspaceRoot: root });
    assert.strictEqual(result.code, 'INTERNAL_ERROR');
  });

  it('strips stack frames and workspace prefixes from text', () => {
    const text = `failed at ${root}/a.txt\n    at fn (/x/y.js:1:1)`;
    const sanitized = sanitizeText(text, root);
    assert.ok(!sanitized.includes(root));
    assert.ok(!sanitized.includes('at fn'));
    assert.ok(sanitized.includes('a.txt'));
  });
});
