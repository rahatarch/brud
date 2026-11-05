/**
 * Goal 10 — legacy MCP parity.
 *
 * The deleted `packages/mcp` envelope was `{ content: [{ type: 'text', text }],
 * isError }` for both success and tool-level failure; only malformed requests
 * became JSON-RPC errors. These tests pin that envelope and the documented
 * legacy message/error semantics through a real SDK client.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  connectSdkClient,
  createWorkspace,
  textOf,
} from './support/harness.js';
import type { SdkClientHarness } from './support/harness.js';

let workspace = '';
let sdk: SdkClientHarness;

before(async () => {
  workspace = await createWorkspace('brud-legacy-parity-');
  await mkdir(join(workspace, 'src'), { recursive: true });
  await mkdir(join(workspace, 'docs'), { recursive: true });
  await writeFile(join(workspace, 'src', 'app.ts'), 'export const app = true;\n', 'utf8');
  await writeFile(join(workspace, 'src', 'util.ts'), 'export const util = true;\n', 'utf8');
  await writeFile(join(workspace, 'docs', 'guide.md'), '# Guide\n', 'utf8');
  await writeFile(join(workspace, 'readable.txt'), 'legacy parity\n', 'utf8');
  sdk = await connectSdkClient(workspace);
});

after(async () => {
  await sdk.close().catch(() => undefined);
  await rm(workspace, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  return await sdk.client.callTool({ name, arguments: args }) as unknown as CallToolResult;
}

function contentOf(result: CallToolResult): readonly { readonly type?: string; readonly text?: string }[] {
  return (result.content ?? []) as unknown as readonly { readonly type?: string; readonly text?: string }[];
}

describe('Goal 10 — MCP envelope shape', () => {
  it('returns one text content block for a successful read_file', async () => {
    const result = await call('read_file', { filePath: 'readable.txt' });
    const content = contentOf(result);

    assert.equal(result.isError, false);
    assert.equal(content.length, 1);
    assert.equal(content[0]?.type, 'text');
    assert.equal(typeof content[0]?.text, 'string');
    assert.ok((content[0]?.text ?? '').length > 0);
  });

  it('returns one text content block for a successful create_file', async () => {
    const result = await call('create_file', {
      path: 'legacy-created.txt',
      content: 'created\n',
    });
    const content = contentOf(result);

    assert.equal(result.isError, false);
    assert.equal(content.length, 1);
    assert.equal(content[0]?.type, 'text');
  });

  it('returns one text content block for a successful search_files', async () => {
    const result = await call('search_files', { patterns: ['**/*.ts'] });
    const content = contentOf(result);

    assert.equal(result.isError, false);
    assert.equal(content.length, 1);
    assert.equal(content[0]?.type, 'text');
  });

  it('keeps tool failures as tool-level isError, not JSON-RPC errors', async () => {
    const result = await call('tool_that_does_not_exist', {});

    assert.equal(result.isError, true);
    assert.equal(contentOf(result).length, 1);
    assert.equal(contentOf(result)[0]?.type, 'text');
  });
});

describe('Goal 10 — legacy message text', () => {
  it('reports read_file using the documented read summary', async () => {
    const result = await call('read_file', { filePath: 'readable.txt' });

    assert.match(textOf(result), /Read summary: delivered=1 file\(s\)/u);
  });

  it('reports create_file as "Created X."', async () => {
    const result = await call('create_file', {
      path: 'created-format.txt',
      content: 'format\n',
    });

    assert.equal(textOf(result), 'Created created-format.txt.');
  });

  it('returns search_files data in the documented JSON shape', async () => {
    const result = await call('search_files', { patterns: ['**/*.ts'] });
    const parsed = JSON.parse(textOf(result)) as {
      readonly results?: readonly { readonly path?: string }[];
      readonly totalMatches?: number;
      readonly truncated?: boolean;
    };

    assert.ok(Array.isArray(parsed.results));
    assert.equal(parsed.totalMatches, parsed.results?.length);
    assert.equal(typeof parsed.truncated, 'boolean');
    assert.deepEqual(
      parsed.results?.map((entry) => entry.path).sort(),
      ['src/app.ts', 'src/util.ts'],
    );
  });

  it('includes CONFLICT in a create_file failure', async () => {
    await call('create_file', { path: 'conflict.txt', content: 'one\n' });
    const result = await call('create_file', { path: 'conflict.txt', content: 'two\n' });

    assert.equal(result.isError, true);
    assert.match(textOf(result), /CONFLICT/u);
  });
});

describe('Goal 10 — failure codes and leakage', () => {
  it('includes FILE_NOT_FOUND for a missing read_file target', async () => {
    const result = await call('read_file', { filePath: 'missing-legacy-file.txt' });

    assert.equal(result.isError, true);
    assert.match(textOf(result), /FILE_NOT_FOUND/u);
  });

  it('includes TOOL_NOT_FOUND for an unknown tool', async () => {
    const result = await call('unknown-legacy-tool', {});

    assert.equal(result.isError, true);
    assert.match(textOf(result), /TOOL_NOT_FOUND/u);
  });

  it('includes WORKSPACE_PATH_VIOLATION for a traversal target', async () => {
    const result = await call('create_file', {
      path: '../outside-workspace.txt',
      content: 'escape\n',
    });

    assert.equal(result.isError, true);
    assert.match(textOf(result), /WORKSPACE_PATH_VIOLATION/u);
  });

  it('does not include stack traces in success or failure envelopes', async () => {
    const texts = [
      textOf(await call('read_file', { filePath: 'readable.txt' })),
      textOf(await call('search_files', { patterns: ['**/*.ts'] })),
      textOf(await call('create_file', { path: 'readable.txt', content: 'conflict\n' })),
      textOf(await call('missing-tool', {})),
    ];

    for (const text of texts) {
      assert.doesNotMatch(text, /\n\s+at\s|node_modules|packages\/kernel/u);
    }
  });

  it('does not leak an absolute workspace path into a failure envelope', async () => {
    const result = await call('create_file', { path: 'readable.txt', content: 'conflict\n' });

    assert.equal(result.isError, true);
    assert.equal(textOf(result).includes(workspace), false);
  });
});