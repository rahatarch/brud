/**
 * Goal 6 — MCP tool dispatch parity.
 *
 * The bridge reads the live `brud.core.tools` registry and dispatches through
 * `context.executeTool`, the same path the UI uses. Real leaf plugins register
 * the tools; the bridge only adapts MCP envelopes.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { IBrudPlugin, OperationResult } from '@brud/kernel';
import {
  bootBridgeHarness,
  isErrorOf,
  syntheticPlugin,
  textOf,
} from './support/harness.test.js';
import type { BridgeHarness, McpResponse } from './support/harness.test.js';

const READER_ID = 'akkhar-labs.plugin.reader';
const FILESYSTEM_ID = 'akkhar-labs.plugin.filesystem';

let harness: BridgeHarness;

before(async () => {
  harness = await bootBridgeHarness({ prefix: 'brud-mcp-parity-' });
  await mkdir(join(harness.root, 'src'), { recursive: true });
  await mkdir(join(harness.root, 'docs'), { recursive: true });
  await writeFile(join(harness.root, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
  await writeFile(join(harness.root, 'src', 'b.ts'), 'export const b = 2;\n', 'utf8');
  await writeFile(join(harness.root, 'docs', 'readme.md'), '# Readme\n', 'utf8');
  await writeFile(join(harness.root, 'smoke.txt'), 'parity smoke\n', 'utf8');
});

after(async () => {
  await harness.shutdown();
});

function direct(name: string, input: Record<string, unknown>): Promise<OperationResult> {
  return harness.tools.executeTool(name, input, {
    workspaceRoot: harness.root,
    callerId: 'verification.mcp',
  });
}

describe('Goal 6 — live catalog', () => {
  it('lists a Reader tool registered by the Reader plugin', async () => {
    const tools = await harness.listTools();

    assert.ok(tools.some((tool) => tool.name === 'read_file'));
  });

  it('lists a Search tool registered by the Search plugin', async () => {
    const tools = await harness.listTools();

    assert.ok(tools.some((tool) => tool.name === 'search_files'));
  });

  it('lists a Structure tool registered by the Structure plugin', async () => {
    const tools = await harness.listTools();

    assert.ok(tools.some((tool) => tool.name === 'extract_structure'));
  });

  it('lists a Filesystem tool registered by the Filesystem plugin', async () => {
    const tools = await harness.listTools();

    assert.ok(tools.some((tool) => tool.name === 'create_file'));
  });

  it('matches getBrudTools().listTools() name-for-name and schema-for-schema', async () => {
    const expected = harness.tools.listTools();
    const actual = await harness.listTools();

    assert.deepEqual(
      actual.map((tool) => tool.name),
      expected.map((tool) => tool.name),
    );

    for (const tool of expected) {
      const listed = actual.find((entry) => entry.name === tool.name);

      assert.ok(listed, `${tool.name} must be listed through MCP`);
      assert.deepEqual(listed.inputSchema, tool.parametersSchema);
    }
  });
});

describe('Goal 6 — dispatch parity with executeTool', () => {
  it('dispatches search_files with the same data as executeTool', async () => {
    const input = { patterns: ['**/*.ts'] };
    const expected = await direct('search_files', input);
    const response = await harness.callTool('search_files', input);

    assert.equal(expected.status, 'success', String(expected.error));
    assert.equal(isErrorOf(response), false);
    assert.deepEqual(JSON.parse(textOf(response)), expected.data);
  });

  it('dispatches read_file with the same message as executeTool', async () => {
    const expected = await direct('read_file', { filePath: 'smoke.txt' });
    const response = await harness.callTool('read_file', { filePath: 'smoke.txt' });

    assert.equal(expected.status, 'success', String(expected.error));
    assert.equal(isErrorOf(response), false);
    assert.equal(textOf(response), expected.message);
  });

  it('dispatches create_file and writes the real file', async () => {
    const response = await harness.callTool('create_file', {
      path: 'bridge-created.txt',
      content: 'written through MCP\n',
    });

    assert.equal(isErrorOf(response), false);
    assert.match(textOf(response), /Created bridge-created\.txt\./u);
    assert.equal(
      await readFile(join(harness.root, 'bridge-created.txt'), 'utf8'),
      'written through MCP\n',
    );
  });

  it('returns TOOL_NOT_FOUND for an unknown tool', async () => {
    const response = await harness.callTool('not_registered_anywhere', {});

    assert.equal(isErrorOf(response), true);
    assert.match(textOf(response), /TOOL_NOT_FOUND/u);
  });

  it('calls through context.executeTool, observable as a real handler invocation', async () => {
    let calls = 0;
    const counting: IBrudPlugin = {
      manifest: {
        id: 'test.parity.counting',
        name: 'Counting',
        version: '0.0.1',
        permissions: ['tools:register'],
      },
      activate(context): void {
        context.registerTool({
          name: 'count_calls',
          description: 'Count bridge invocations',
          parametersSchema: { type: 'object', properties: {}, additionalProperties: false },
          execute: async (): Promise<OperationResult> => {
            calls += 1;

            return { status: 'success', message: 'counted' };
          },
        });
      },
    };
    const countingHarness = await bootBridgeHarness({
      prefix: 'brud-mcp-parity-count-',
      plugins: [counting],
    });

    try {
      const response = await countingHarness.callTool('count_calls', {});

      assert.equal(isErrorOf(response), false);
      assert.equal(textOf(response), 'counted');
      assert.equal(calls, 1);
    } finally {
      await countingHarness.shutdown();
    }
  });
});

describe('Goal 6 — deregistration is immediate', () => {
  it('removes the Reader tools from tools/list when Reader is deactivated', async () => {
    await harness.deactivate(READER_ID);
    const tools = await harness.listTools();

    assert.equal(tools.some((tool) => tool.name === 'read_file'), false);
  });

  it('returns TOOL_NOT_FOUND after the tool was deregistered', async () => {
    const response = await harness.callTool('read_file', { filePath: 'smoke.txt' });

    assert.equal(isErrorOf(response), true);
    assert.match(textOf(response), /TOOL_NOT_FOUND/u);
  });

  it('removes the Filesystem tools when Filesystem is deactivated', async () => {
    await harness.deactivate(FILESYSTEM_ID);
    const tools = await harness.listTools();

    assert.equal(tools.some((tool) => tool.name === 'create_file'), false);
  });
});

describe('Goal 6 — independent bridge instances', () => {
  it('keeps two kernels and two bridges independent', async () => {
    const alpha = await bootBridgeHarness({
      prefix: 'brud-mcp-parity-alpha-',
      plugins: [syntheticPlugin('test.parity.alpha.plugin', 'alpha_tool')],
    });
    const beta = await bootBridgeHarness({
      prefix: 'brud-mcp-parity-beta-',
      plugins: [syntheticPlugin('test.parity.beta.plugin', 'beta_tool')],
    });

    try {
      const alphaNames = (await alpha.listTools()).map((tool) => tool.name);
      const betaNames = (await beta.listTools()).map((tool) => tool.name);

      assert.deepEqual(alphaNames, ['alpha_tool']);
      assert.deepEqual(betaNames, ['beta_tool']);
    } finally {
      await alpha.shutdown();
      await beta.shutdown();
    }
  });

  it('maps a failed tool result onto isError true', async () => {
    const failing = await bootBridgeHarness({
      prefix: 'brud-mcp-parity-failing-',
      plugins: [
        syntheticPlugin('test.parity.failing.plugin', 'failing_tool', {
          status: 'failed',
          error: 'SYNTHETIC_FAILURE',
        }),
      ],
    });

    try {
      const response: McpResponse = await failing.callTool('failing_tool', {});

      assert.equal(isErrorOf(response), true);
      assert.equal(textOf(response), 'SYNTHETIC_FAILURE');
    } finally {
      await failing.shutdown();
    }
  });
});