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

describe('MCP structural sanitization', () => {
  let root: string;

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-structural-'));
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function contentEnvelope(content: string): unknown {
    return {
      status: 'success',
      data: {
        success: true,
        readResults: [
          {
            operationIndex: 0,
            totalFiles: 1,
            totalSize: Buffer.byteLength(content, 'utf8'),
            files: [
              {
                path: `${root}/a.txt`,
                content,
                size: Buffer.byteLength(content, 'utf8'),
                startLine: 1,
                endLine: 4,
                totalLines: 4,
              },
            ],
          },
        ],
        operationResults: [
          {
            operationIndex: 0,
            kind: 'read_file',
            status: 'success',
            path: `${root}/a.txt`,
            message: `read ${root}/a.txt\n    at readOperation (/internal/dispatch.js:1:1)`,
          },
        ],
      },
    };
  }

  it('leaves file content byte-identical while redacting metadata paths', async () => {
    const content = `const root = '${root}'; // workspace-like string inside a file body\n    at fakeFrame (/not/a/stack.js:1:1)\nexport const done = true;\n`;
    const kernel = stubKernel(async () => contentEnvelope(content));

    const result = await dispatchToolCall(kernel, 'read_file', { filePath: 'a.txt' }, { workspaceRoot: root });
    assert.strictEqual(result.isError, false);

    const parsed = JSON.parse(result.content[0].text) as {
      readResults: Array<{ totalFiles: number; files: Array<Record<string, unknown>> }>;
      operationResults: Array<Record<string, unknown>>;
    };

    const file = parsed.readResults[0].files[0];
    assert.strictEqual(file.content, content, 'file content must survive byte-identically');
    assert.strictEqual(file.size, Buffer.byteLength(content, 'utf8'));

    const filePathField = file.path as string;
    assert.ok(!filePathField.includes(root), 'file path must be redacted');
    assert.ok(!filePathField.includes(root + path.sep), 'file path must not leak the workspace prefix');

    const opMessage = parsed.operationResults[0].message as string;
    assert.ok(!opMessage.includes(root), 'operation message must be redacted');
    assert.ok(!opMessage.includes('at readOperation'), 'operation message stack frame must be filtered');

    assert.strictEqual(parsed.readResults[0].totalFiles, 1);
  });

  it('recursively sanitizes nested metadata fields only', async () => {
    const kernel = stubKernel(async () => ({
      status: 'success',
      data: {
        success: true,
        errors: [{ details: `missing ${root}/gone.txt\n    at inner (/x/y.js:1:1)`, friendly: `Cannot read ${root}/gone.txt` }],
        nested: { deeper: { directoryPath: `${root}/src`, note: `mentions ${root}/src but is not a path field` } },
        fileResults: { modified: [`${root}/a.txt`], skipped: [], failed: [] },
      },
    }));

    const result = await dispatchToolCall(kernel, 'read_file', { filePath: 'a.txt' }, { workspaceRoot: root });
    const parsed = JSON.parse(result.content[0].text) as {
      errors: Array<{ details: string; friendly: string }>;
      nested: { deeper: { directoryPath: string; note: string } };
      fileResults: { modified: string[] };
    };

    assert.ok(!parsed.errors[0].details.includes(root));
    assert.ok(!parsed.errors[0].details.includes('at inner'));
    assert.ok(!parsed.errors[0].friendly.includes(root));
    assert.ok(!parsed.nested.deeper.directoryPath.includes(root));
    assert.ok(parsed.nested.deeper.note.includes(root), 'non-path string fields are untouched');
    assert.ok(parsed.fileResults.modified.every((entry) => !entry.includes(root)));
  });

  it('prefers structured data over the legacy message when both are present', async () => {
    const kernel = stubKernel(async () => ({
      status: 'success',
      message: `legacy ${root}/a.txt`,
      data: { success: true, operationResults: [] },
    }));

    const result = await dispatchToolCall(kernel, 'read_file', { filePath: 'a.txt' }, { workspaceRoot: root });
    const parsed = JSON.parse(result.content[0].text) as { success: boolean; operationResults: unknown[] };
    assert.strictEqual(parsed.success, true);
    assert.deepStrictEqual(parsed.operationResults, []);
  });

  it('retains the message-first fallback when structured data is absent', async () => {
    const kernel = stubKernel(async () => ({
      status: 'success',
      message: `done ${root}/a.txt\n    at legacy (/x/y.js:1:1)`,
    }));

    const result = await dispatchToolCall(kernel, 'read_file', { filePath: 'a.txt' }, { workspaceRoot: root });
    const text = result.content[0].text;
    assert.ok(text.includes('done'));
    assert.ok(!text.includes(root));
    assert.ok(!text.includes('at legacy'));
  });

  it('emits a single valid JSON document with stable structure', async () => {
    const kernel = stubKernel(async () => contentEnvelope('plain text'));
    const result = await dispatchToolCall(kernel, 'read_file', { filePath: 'a.txt' }, { workspaceRoot: root });

    assert.strictEqual(typeof result.content[0].text, 'string');
    const parsed = JSON.parse(result.content[0].text);
    assert.deepStrictEqual(Object.keys(parsed).sort(), ['operationResults', 'readResults', 'success']);
    assert.strictEqual(result.content.length, 1);
  });
});
