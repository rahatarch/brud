import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BrudToolsToken } from '../descriptor/tokens.js';
import { BRUD_TOOLS_SERVICE_TIER, createBrudToolsDescriptor } from '../descriptor/BrudToolsDescriptor.js';
import { bootWithBrudTools, reports, type TestParticipant } from './support/kernelHarness.js';

const SCHEMA = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
const SURFACE = "['registerTool', 'executeTool', 'validateTool'].filter((key) => typeof tools[key] === 'function')";
const RUN = "{ workspaceRoot: '/tmp/brud-tools-test' }";

/** Registers three tools: an echo, one needing `net:fetch`, one the allow-list disables. */
const toolsmith: TestParticipant = {
  token: 'acme.toolsmith',
  capabilities: ['tools:register'],
  onRunning: `
    const tools = registry.resolve('brud.tools');
    report.surface = ${SURFACE};
    const echo = (input, ctx) => Promise.resolve({ status: 'success', data: { input, callerId: ctx.callerId, permissions: ctx.permissions, origin: ctx.origin } });
    tools.registerTool({ name: 'acme.echo', description: 'echo', parametersSchema: ${JSON.stringify(SCHEMA)}, execute: echo });
    tools.registerTool({ name: 'acme.guarded', description: 'needs net', parametersSchema: { type: 'object' }, requiredPermissions: ['net:fetch'], execute: echo });
    tools.registerTool({ name: 'acme.off', description: 'disabled', parametersSchema: { type: 'object' }, execute: echo });
    report.listed = tools.listTools().map((tool) => ({ name: tool.name, owner: tool.ownerPluginId, official: tool.isOfficial }));
  `,
};

/** A settings giver declaring the exposure BrudTools reads its allow-list from. */
const settings: TestParticipant = {
  token: 'acme.settings',
  exposures: [{ name: 'brud.settings.reader', version: 1, scope: 'any' }],
  bindings: "{ 'brud.settings.reader@1': () => ({ getSnapshot: () => ({ toolAllowList: { 'acme.off': false } }) }) }",
};

const runner: TestParticipant = {
  token: 'acme.runner',
  capabilities: ['tools:execute'],
  onRunning: `
    const tools = registry.resolve('brud.tools');
    report.surface = ${SURFACE};
    report.ok = await tools.executeTool('acme.echo', { text: 'hi' }, ${RUN});
    report.invalid = await tools.executeTool('acme.echo', { text: 5 }, ${RUN});
    report.guarded = await tools.executeTool('acme.guarded', {}, ${RUN});
    report.missing = await tools.executeTool('acme.nope', {}, ${RUN});
    report.off = await tools.executeTool('acme.off', {}, ${RUN});
    report.dry = tools.validateTool('acme.echo', { text: 'x' }, ${RUN});
    try { tools.executeTool('acme.echo', { text: 'x' }, {}); report.noRoot = 'accepted'; } catch (error) { report.noRoot = error.name; }
  `,
};

const nobody: TestParticipant = { token: 'acme.nobody', onRunning: "report.handle = registry.resolve('brud.tools');" };

describe('BrudTools on the v1 kernel (brud.tools@1)', () => {
  it('keeps its token and tier', () => {
    const descriptor = createBrudToolsDescriptor();

    assert.equal(descriptor.token.id, BrudToolsToken.id);
    assert.equal(descriptor.tier, BRUD_TOOLS_SERVICE_TIER);
    assert.deepEqual(descriptor.manifest?.exposures, [{ name: 'brud.tools', version: 1, scope: 'runtime' }]);
  });

  it('shapes the handle by capability, takes identity from the kernel, and enforces schema, permissions and the allow-list', async (t) => {
    await bootWithBrudTools(t, [toolsmith, settings, runner, nobody, { token: 'acme.probe', capabilities: ['tools:execute'], onRunning: "report.id = registry.resolve('brud.tools').executeTool('acme.echo', { text: 'p' }, { workspaceRoot: '/' }).then((r) => r.data.callerId);" }]);
    const r = reports();
    const smith = r['acme.toolsmith'];
    const run = r['acme.runner'];
    const ok = run?.ok as { status: string; data: { input: unknown; callerId: string; permissions: string[]; origin: string } };

    // Surfaces: register-only vs execute-only; no capability → no handle.
    assert.deepEqual(smith?.surface, ['registerTool']);
    assert.deepEqual(run?.surface, ['executeTool', 'validateTool']);
    assert.equal(r['acme.nobody']?.handle, null);

    // The owner and officialness are the real caller's (the composition's), not claimed.
    const listed = smith?.listed as { name: string; owner: string; official: boolean }[];
    assert.equal(listed.length, 3);
    assert.ok(listed.every((tool) => tool.official === true && typeof tool.owner === 'string' && tool.owner !== 'acme.toolsmith'));

    // Execution: the tool sees the runner's kernel identity and capabilities.
    assert.equal(ok.status, 'success');
    assert.deepEqual(ok.data.input, { text: 'hi' });
    assert.deepEqual(ok.data.permissions, ['tools:execute']);
    assert.equal(ok.data.origin, 'runtime');
    assert.notEqual(ok.data.callerId, listed[0]?.owner);
    assert.equal(ok.data.callerId === (await r['acme.probe']?.id), false, 'two participants have distinct identities');

    // Gates.
    assert.match(String((run?.invalid as { error: string }).error), /^TOOL_VALIDATION_ERROR/u);
    assert.match(String((run?.guarded as { error: string }).error), /^TOOL_PERMISSION_DENIED/u);
    assert.match(String((run?.missing as { error: string }).error), /^TOOL_NOT_FOUND/u);
    assert.match(String((run?.off as { error: string }).error), /^TOOL_DISABLED/u);
    assert.notEqual((run?.dry as { status: string }).status, 'failed');
    assert.equal(run?.noRoot, 'TypeError');
  });

  it('allows every tool when no settings giver resolves (fail open)', async (t) => {
    await bootWithBrudTools(t, [toolsmith, { ...runner, onRunning: `report.off = await registry.resolve('brud.tools').executeTool('acme.off', {}, ${RUN});` }]);

    assert.equal((reports()['acme.runner']?.off as { status: string }).status, 'success');
  });

  it('lets a caged participant list and execute tools through brud.call, as itself', async (t) => {
    const request = JSON.stringify({ name: 'brud.tools', method: 'executeTool', args: ['acme.echo', { text: 'from-wasm' }, { workspaceRoot: '/tmp/brud-tools-test' }] });
    const wat = `(module
      (import "brud" "call" (func $call (param i32 i32) (result i64)))
      (memory (export "memory") 1)
      (data (i32.const 0) ${JSON.stringify(request)})
      (func (export "brud_alloc") (param i32) (result i32) (i32.const 2048))
      (func (export "brud_invoke") (param i32 i32) (result i64) (call $call (i32.const 0) (i32.const ${String(Buffer.byteLength(request))}))))`;
    const caged: TestParticipant = {
      token: 'acme.caged',
      package: {
        wat,
        manifest: { requests: { capabilities: ['tools:execute'] }, exposures: [{ name: 'acme.caged.tools', version: 1, scope: 'any' }], events: [] },
      },
    };

    await bootWithBrudTools(t, [toolsmith, caged, { token: 'acme.asker', onRunning: "report.result = await registry.resolve('acme.caged.tools').run();" }]);
    const result = reports()['acme.asker']?.result as { status: string; data: { input: unknown; permissions: string[]; origin: string; callerId: string } };

    // The tool ran (async) for the caged participant, as the caged participant.
    assert.equal(result.status, 'success');
    assert.deepEqual(result.data.input, { text: 'from-wasm' });
    assert.deepEqual(result.data.permissions, ['tools:execute']);
    assert.equal(typeof result.data.callerId, 'string');
  });
});
