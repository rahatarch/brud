import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { OperationResult } from '../../src/contracts/handler.js';
import type { IPluginExecutionContext } from '../../services/BrudTools/contracts/IBrudToolsService.js';
import type { IBrudPlugin } from '../../services/PluginManager/contracts/IBrudPlugin.js';
import { bootRealKernel } from './support/realKernel.js';
import { ParserRouterHarness } from './support/parserRouterHarness.js';

const PLUGIN_ID = 'com.test.adversarial';

function brud(...blocks: readonly string[]): string {
  return ['[BRUD]', ...blocks, '[/BRUD]'].join('\n');
}

function call(toolName: string, ...body: readonly string[]): string {
  return [`[CALL ${toolName}]`, ...body, '[END]'].join('\n');
}

function adversarialPlugin(): IBrudPlugin {
  return {
    manifest: {
      id: PLUGIN_ID,
      name: 'Adversarial Test Tools',
      version: '1.0.0',
      permissions: ['tools:register', 'tools:execute'],
    },
    activate: (context): void => {
      context.registerTool({
        name: 'adv_echo',
        description: 'Writes a marker file and echoes the supplied text.',
        parametersSchema: {
          type: 'object',
          properties: {
            file: { type: 'string' },
            text: { type: 'string' },
          },
          required: ['file', 'text'],
        },
        requiredPermissions: ['tools:execute'],
        execute: async (input, executionContext): Promise<OperationResult> => {
          const text = String(input.text);
          await writeFile(
            join(executionContext.workspaceRoot, String(input.file)),
            JSON.stringify({ text }),
            'utf8',
          );
          return { status: 'success', data: { text } };
        },
      });

      context.registerTool({
        name: 'adv_deploy',
        description: 'Accepts a protected code payload.',
        parametersSchema: {
          type: 'object',
          properties: {
            region: { type: 'string' },
            memory: {
              oneOf: [
                { type: 'integer', minimum: 128, maximum: 10240 },
                { type: 'string', pattern: '^[0-9]+$' },
              ],
            },
            code: { type: 'string', protected: true },
          },
          required: ['region', 'memory', 'code'],
        },
        execute: async (input, executionContext): Promise<OperationResult> => {
          const payload = {
            region: String(input.region),
            memory: Number(input.memory),
            code: String(input.code),
          };
          await writeFile(
            join(executionContext.workspaceRoot, 'deploy-sentinel.json'),
            JSON.stringify(payload),
            'utf8',
          );
          return { status: 'success', data: payload };
        },
      });

      context.registerTool({
        name: 'adv_fail',
        description: 'Returns a typed failure result.',
        parametersSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
        execute: async (): Promise<OperationResult> => ({
          status: 'failed',
          error: 'intentional failure',
        }),
      });

      context.registerTool({
        name: 'adv_throw_sync',
        description: 'Throws synchronously.',
        parametersSchema: { type: 'object', properties: {} },
        execute: (): Promise<OperationResult> => {
          throw new Error('synchronous handler boom');
        },
      });

      context.registerTool({
        name: 'adv_throw_async',
        description: 'Rejects asynchronously.',
        parametersSchema: { type: 'object', properties: {} },
        execute: async (): Promise<OperationResult> => {
          throw new Error('asynchronous handler boom');
        },
      });

      context.registerTool({
        name: 'adv_undefined',
        description: 'Returns undefined.',
        parametersSchema: { type: 'object', properties: {} },
        execute: async (): Promise<OperationResult> =>
          undefined as unknown as OperationResult,
      });

      context.registerTool({
        name: 'adv_unexpected',
        description: 'Returns an unexpected object shape.',
        parametersSchema: { type: 'object', properties: {} },
        execute: async (): Promise<OperationResult> =>
          ({ unexpected: 'shape' } as unknown as OperationResult),
      });

      context.registerTool({
        name: 'adv_write_then_throw',
        description: 'Writes a file and then throws.',
        parametersSchema: {
          type: 'object',
          properties: { file: { type: 'string' } },
          required: ['file'],
        },
        execute: async (input, executionContext): Promise<OperationResult> => {
          await writeFile(
            join(executionContext.workspaceRoot, String(input.file)),
            'partial side effect',
            'utf8',
          );
          throw new Error('failed after writing a file');
        },
      });

      context.registerTool({
        name: 'adv_mutate',
        description: 'Mutates its input object and reports the original value.',
        parametersSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
        execute: async (input): Promise<OperationResult> => {
          const observed = String(input.text);
          input.text = 'mutated-by-handler';
          return { status: 'success', data: { observed } };
        },
      });

      context.registerTool({
        name: 'adv_typed',
        description: 'Requires an object-valued parameter.',
        parametersSchema: {
          type: 'object',
          properties: { config: { type: 'object' } },
          required: ['config'],
        },
        execute: async (): Promise<OperationResult> => ({
          status: 'success',
          data: { accepted: true },
        }),
      });

      context.registerTool({
        name: 'adv_long',
        description: 'Declares a bounded string length.',
        parametersSchema: {
          type: 'object',
          properties: { text: { type: 'string', maxLength: 64 } },
          required: ['text'],
        },
        execute: async (): Promise<OperationResult> => {
          return { status: 'success', data: { accepted: true } };
        },
      });
    },
  };
}

function dispatchContext(
  root: string,
  permissions: readonly string[] = ['tools:execute'],
): IPluginExecutionContext {
  return {
    workspaceRoot: root,
    callerId: PLUGIN_ID,
    permissions: [...permissions],
  };
}

interface AdversarialKernel {
  readonly root: string;
  readonly tools: ParserRouterHarness;
}

async function bootAdversarial(
  t: TestContext,
  prefix: string,
): Promise<AdversarialKernel> {
  const { kernel, root } = await bootRealKernel(t, {
    prefix: `brud-parser-adversarial-${prefix}-`,
    initialPlugins: [adversarialPlugin()],
  });
  const tools = ParserRouterHarness.fromKernel(kernel, root);

  return { root, tools };
}

async function assertMissing(path: string): Promise<void> {
  await assert.rejects(access(path), /ENOENT/);
}

describe('A. Protocol parser attacks', () => {
  it('P-01 rejects a document missing the [BRUD] opening wrapper', async (t) => {
    const { tools } = await bootAdversarial(t, 'p01');
    const parsed = tools.parseInput(call('adv_echo', 'file: p01.json', 'text: x'));

    assert.equal(parsed.ok, false);
    if (parsed.ok) {
      return;
    }
    assert.equal(parsed.error.code, 'PARSE_ERROR');
    assert.match(parsed.error.friendly, /missing \[BRUD\] wrapper/);
  });

  it('P-02 rejects a document missing the [/BRUD] closing wrapper', async (t) => {
    const { tools } = await bootAdversarial(t, 'p02');
    const parsed = tools.parseInput([
      '[BRUD]',
      '[CALL adv_echo]',
      'file: p02.json',
      'text: x',
      '[END]',
    ].join('\n'));

    assert.equal(parsed.ok, false);
    if (parsed.ok) {
      return;
    }
    assert.equal(parsed.error.code, 'PARSE_ERROR');
    assert.match(parsed.error.friendly, /unterminated \[BRUD\] wrapper/);
  });

  it('P-03 rejects an empty [BRUD][/BRUD] document', async (t) => {
    const { tools } = await bootAdversarial(t, 'p03');
    const parsed = tools.parseInput('[BRUD][/BRUD]');

    assert.equal(parsed.ok, false);
    if (parsed.ok) {
      return;
    }
    assert.equal(parsed.error.code, 'PARSE_ERROR');
    assert.match(parsed.error.friendly, /wrapper contains no \[CALL\] block/);
  });

  it('P-04 rejects an empty [CALL ] block with no tool name', async (t) => {
    const { tools } = await bootAdversarial(t, 'p04');
    const parsed = tools.parseInput(brud('[CALL ]', '[END]'));

    assert.equal(parsed.ok, false);
    if (parsed.ok) {
      return;
    }
    assert.equal(parsed.error.code, 'PARSE_ERROR');
    assert.match(parsed.error.friendly, /expected \[CALL <kind> <name>\]/);
  });

  it('P-05 rejects a [CALL] block missing [END]', async (t) => {
    const { tools } = await bootAdversarial(t, 'p05');
    const parsed = tools.parseInput(brud(
      '[CALL adv_echo]',
      'file: p05.json',
      'text: x',
    ));

    assert.equal(parsed.ok, false);
    if (parsed.ok) {
      return;
    }
    assert.equal(parsed.error.code, 'PARSE_ERROR');
    assert.match(parsed.error.friendly, /missing \[END\] for \[CALL\]/);
  });

  it('P-06 rejects nested [CALL] blocks', async (t) => {
    const { tools } = await bootAdversarial(t, 'p06');
    const parsed = tools.parseInput(brud([
      '[CALL adv_echo]',
      'file: p06.json',
      'text: x',
      '[CALL adv_echo]',
      'file: p06-inner.json',
      'text: y',
      '[END]',
      '[END]',
    ].join('\n')));

    assert.equal(parsed.ok, false);
    if (parsed.ok) {
      return;
    }
    assert.equal(parsed.error.code, 'PARSE_ERROR');
    assert.match(parsed.error.friendly, /nested \[CALL\] is not allowed/);
  });

  it('P-07 rejects multiple [END] markers', async (t) => {
    const { tools } = await bootAdversarial(t, 'p07');
    const parsed = tools.parseInput(brud(
      '[CALL adv_echo]',
      'file: p07.json',
      'text: x',
      '[END]',
      '[END]',
    ));

    assert.equal(parsed.ok, false);
    if (parsed.ok) {
      return;
    }
    assert.equal(parsed.error.code, 'PARSE_ERROR');
    assert.match(parsed.error.friendly, /expected \[CALL <kind> <name>\]/);
  });

  it('P-09 rejects duplicate parameter names', async (t) => {
    const { tools } = await bootAdversarial(t, 'p09');
    const parsed = tools.parseInput(brud(
      '[CALL adv_echo]',
      'file: p09.json',
      'text: first',
      'text: second',
      '[END]',
    ));

    assert.equal(parsed.ok, false);
    if (parsed.ok) {
      return;
    }
    assert.equal(parsed.error.code, 'PARSE_ERROR');
    assert.match(parsed.error.friendly, /duplicate parameter "text"/);
  });

  it('P-13 rejects invalid JSON-like values through the schema gate', async (t) => {
    const { root, tools } = await bootAdversarial(t, 'p13');
    const routed = await tools.parseAndRoute(brud(
      '[CALL adv_typed]',
      'config: {"a":}',
      '[END]',
    ), { callerContext: dispatchContext(root) });

    assert.equal(routed.status, 'failed');
    assert.equal(routed.dispatched, 0);
    assert.equal(routed.failed, 1);
    assert.equal(routed.operations[0]?.status, 'schema_invalid');
    assert.match(String(routed.operations[0]?.error), /TOOL_VALIDATION_ERROR/);
    await assertMissing(join(root, 'typed-sentinel.json'));
  });

  it('P-14 rejects an extremely long parameter value beyond the declared limit', async (t) => {
    const { root, tools } = await bootAdversarial(t, 'p14');
    const oversized = 'x'.repeat(262_144);
    const routed = await tools.parseAndRoute(brud(
      '[CALL adv_long]',
      `text: ${oversized}`,
      '[END]',
    ), { callerContext: dispatchContext(root) });

    assert.equal(routed.status, 'failed');
    assert.equal(routed.dispatched, 0);
    assert.equal(routed.failed, 1);
    assert.equal(routed.operations[0]?.status, 'schema_invalid');
    assert.match(String(routed.operations[0]?.error), /at most 64 characters/);
  });

  it('P-15 preserves Unicode and emoji in parameter values exactly', async (t) => {
    const { tools } = await bootAdversarial(t, 'p15');
    const text = 'héllo 🌍 日本語 🚀';
    const parsed = tools.parseInput(brud(
      '[CALL adv_echo]',
      'file: p15.json',
      `text: ${text}`,
      '[END]',
    ));

    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }
    assert.equal(parsed.operations[0]?.parameters.text, text);
  });

  it('P-16 parses CRLF and LF line endings consistently', async (t) => {
    const { tools } = await bootAdversarial(t, 'p16');
    const lf = brud(
      '[CALL adv_echo]',
      'file: p16.json',
      'text: line one',
      '[END]',
    );
    const crlf = lf.replace(/\n/g, '\r\n');

    const lfParsed = tools.parseInput(lf);
    const crlfParsed = tools.parseInput(crlf);

    assert.equal(lfParsed.ok, true);
    assert.equal(crlfParsed.ok, true);
    if (!lfParsed.ok || !crlfParsed.ok) {
      return;
    }
    assert.deepEqual(crlfParsed.operations, lfParsed.operations);
  });

  it('P-18 dispatches nothing when a later operation is malformed', async (t) => {
    const { root, tools } = await bootAdversarial(t, 'p18');
    const routed = await tools.parseAndRoute(brud(
      '[CALL adv_echo]',
      'file: p18-first.json',
      'text: valid first operation',
      '[END]',
      '[CALL adv_echo]',
      'file: p18-second.json',
      'this line is not a parameter',
      '[END]',
    ), { callerContext: dispatchContext(root) });

    assert.equal(routed.status, 'failed');
    assert.equal(routed.dispatched, 0);
    assert.equal(routed.failed, 0);
    assert.equal(routed.operations.length, 0);
    assert.equal(routed.parseError?.code, 'PARSE_ERROR');
    await assertMissing(join(root, 'p18-first.json'));
    await assertMissing(join(root, 'p18-second.json'));
  });
});

describe('B. Protected region attacks', () => {
  it('R-01 preserves an empty {code}{/code} region as an empty string', async (t) => {
    const { tools } = await bootAdversarial(t, 'r01');
    const parsed = tools.parseInput(brud(
      '[CALL adv_deploy]',
      'region: us-east-1',
      'memory: 512',
      '{code}',
      '{/code}',
      '[END]',
    ));

    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }
    assert.equal(parsed.operations[0]?.parameters.code, '');
  });

  it('R-02 rejects a protected region missing {/code}', async (t) => {
    const { tools } = await bootAdversarial(t, 'r02');
    const parsed = tools.parseInput(brud(
      '[CALL adv_deploy]',
      'region: us-east-1',
      'memory: 512',
      '{code}',
      'console.log("unterminated")',
      '[END]',
    ));

    assert.equal(parsed.ok, false);
    if (parsed.ok) {
      return;
    }
    assert.equal(parsed.error.code, 'PARSE_ERROR');
  });

  it('R-03 parses a braceless value as plain syntax (schema-agnostic parser)', async (t) => {
    const { tools } = await bootAdversarial(t, 'r03');
    const parsed = tools.parseInput(brud(
      '[CALL adv_deploy]',
      'region: us-east-1',
      'memory: 512',
      'code: console.log("unbraced")',
      '[END]',
    ));

    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }
    assert.equal(parsed.operations[0]?.parameters.code, 'console.log("unbraced")');
  });

  it('R-04 preserves nested brace-like markers as literal protected content', async (t) => {
    const { tools } = await bootAdversarial(t, 'r04');
    const parsed = tools.parseInput(brud(
      '[CALL adv_deploy]',
      'region: us-east-1',
      'memory: 512',
      '{code}',
      '{inner}',
      '{/code}',
      '[END]',
    ));

    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }
    assert.equal(parsed.operations[0]?.parameters.code, '{inner}');
  });

  it('R-07 does not terminate an operation on a literal [END] inside {code}', async (t) => {
    const { tools } = await bootAdversarial(t, 'r07');
    const parsed = tools.parseInput(brud(
      '[CALL adv_deploy]',
      'region: us-east-1',
      'memory: 512',
      '{code}',
      'before',
      '[END]',
      'after',
      '{/code}',
      '[END]',
    ));

    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }
    assert.equal(parsed.operations.length, 1);
    assert.equal(parsed.operations[0]?.parameters.code, 'before\n[END]\nafter');
  });

  it('R-08 does not start an operation on a literal [CALL] inside {code}', async (t) => {
    const { tools } = await bootAdversarial(t, 'r08');
    const parsed = tools.parseInput(brud(
      '[CALL adv_deploy]',
      'region: us-east-1',
      'memory: 512',
      '{code}',
      '[CALL adv_echo]',
      'file: r08-should-not-exist.json',
      'text: nope',
      '{/code}',
      '[END]',
    ));

    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }
    assert.equal(parsed.operations.length, 1);
    assert.match(String(parsed.operations[0]?.parameters.code), /\[CALL adv_echo\]/);
    assert.match(String(parsed.operations[0]?.parameters.code), /r08-should-not-exist/);
  });

  it('R-10 preserves quotes, backslashes and braces inside {code} exactly', async (t) => {
    const { tools } = await bootAdversarial(t, 'r10');
    const content = [
      'const quoted = "say \\"hi\\"";',
      'const path = "C:\\\\temp\\\\file.txt";',
      'const braces = { nested: true };',
      'const backslash = "\\\\";',
    ].join('\n');
    const parsed = tools.parseInput(brud(
      '[CALL adv_deploy]',
      'region: us-east-1',
      'memory: 512',
      '{code}',
      ...content.split('\n'),
      '{/code}',
      '[END]',
    ));

    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }
    assert.equal(parsed.operations[0]?.parameters.code, content);
  });

  it('R-13 rejects a protected region left unclosed at EOF', async (t) => {
    const { tools } = await bootAdversarial(t, 'r13');
    const parsed = tools.parseInput([
      '[BRUD]',
      '[CALL adv_deploy]',
      'region: us-east-1',
      'memory: 512',
      '{code}',
      'console.log("never closed")',
      '[/BRUD]',
    ].join('\n'));

    assert.equal(parsed.ok, false);
    if (parsed.ok) {
      return;
    }
    assert.equal(parsed.error.code, 'PARSE_ERROR');
  });

  it('R-14 rejects a wrong closing tag such as {/script}', async (t) => {
    const { tools } = await bootAdversarial(t, 'r14');
    const parsed = tools.parseInput(brud(
      '[CALL adv_deploy]',
      'region: us-east-1',
      'memory: 512',
      '{code}',
      'console.log("wrong closer")',
      '{/script}',
      '[END]',
    ));

    assert.equal(parsed.ok, false);
    if (parsed.ok) {
      return;
    }
    assert.equal(parsed.error.code, 'PARSE_ERROR');
  });
});

describe('C. Multi-operation execution', () => {
  it('E-01 stops after the first failure when stopOnFailure is true', async (t) => {
    const { root, tools } = await bootAdversarial(t, 'e01');
    const routed = await tools.parseAndRoute(brud(
      call('adv_fail', 'text: first fails'),
      call('adv_echo', 'file: e01-second.json', 'text: must not run'),
    ), { callerContext: dispatchContext(root), stopOnFailure: true });

    assert.equal(routed.dispatched, 1);
    assert.equal(routed.failed, 1);
    assert.equal(routed.status, 'failed');
    assert.equal(routed.operations[0]?.status, 'failed');
    assert.equal(routed.operations[1]?.status, 'skipped');
    await assertMissing(join(root, 'e01-second.json'));
  });

  it('E-02 continues after the first failure when stopOnFailure is false', async (t) => {
    const { root, tools } = await bootAdversarial(t, 'e02');
    const routed = await tools.parseAndRoute(brud(
      call('adv_fail', 'text: first fails'),
      call('adv_echo', 'file: e02-second.json', 'text: must run'),
    ), { callerContext: dispatchContext(root), stopOnFailure: false });

    assert.equal(routed.dispatched, 2);
    assert.equal(routed.failed, 1);
    assert.equal(routed.status, 'partial');
    assert.equal(routed.operations[0]?.status, 'failed');
    assert.equal(routed.operations[1]?.status, 'success');
    const written = JSON.parse(await readFile(join(root, 'e02-second.json'), 'utf8'));
    assert.deepEqual(written, { text: 'must run' });
  });

  it('E-03 aborts before the first operation and dispatches nothing', async (t) => {
    const { root, tools } = await bootAdversarial(t, 'e03');
    const controller = new AbortController();
    controller.abort();
    const routed = await tools.parseAndRoute(brud(
      call('adv_echo', 'file: e03-first.json', 'text: one'),
      call('adv_echo', 'file: e03-second.json', 'text: two'),
    ), {
      callerContext: { ...dispatchContext(root), signal: controller.signal },
    });

    assert.equal(routed.dispatched, 0);
    assert.equal(routed.failed, 0);
    assert.deepEqual(
      routed.operations.map((operation) => operation.status),
      ['aborted', 'aborted'],
    );
    await assertMissing(join(root, 'e03-first.json'));
    await assertMissing(join(root, 'e03-second.json'));
  });

  it('E-06 rejects maxOperations=0 and executes nothing', async (t) => {
    const { root, tools } = await bootAdversarial(t, 'e06');
    const routed = await tools.parseAndRoute(brud(
      call('adv_echo', 'file: e06.json', 'text: x'),
    ), { callerContext: dispatchContext(root), maxOperations: 0 });

    assert.equal(routed.status, 'failed');
    assert.equal(routed.dispatched, 0);
    assert.equal(routed.failed, 0);
    assert.equal(routed.operations.length, 0);
    assert.equal(routed.parseError?.code, 'PARSE_ERROR');
    assert.match(String(routed.parseError?.details), /maxOperations/);
    await assertMissing(join(root, 'e06.json'));
  });

  it('E-08 executes all operations when the count equals maxOperations', async (t) => {
    const { root, tools } = await bootAdversarial(t, 'e08');
    const routed = await tools.parseAndRoute(brud(
      call('adv_echo', 'file: e08-first.json', 'text: one'),
      call('adv_echo', 'file: e08-second.json', 'text: two'),
    ), { callerContext: dispatchContext(root), maxOperations: 2 });

    assert.equal(routed.status, 'success');
    assert.equal(routed.dispatched, 2);
    assert.equal(routed.failed, 0);
    assert.deepEqual(
      routed.operations.map((operation) => operation.status),
      ['success', 'success'],
    );
    const first = JSON.parse(await readFile(join(root, 'e08-first.json'), 'utf8'));
    const second = JSON.parse(await readFile(join(root, 'e08-second.json'), 'utf8'));
    assert.deepEqual(first, { text: 'one' });
    assert.deepEqual(second, { text: 'two' });
  });

  it('E-09 dry-run validates without invoking handlers or writing files', async (t) => {
    const { root, tools } = await bootAdversarial(t, 'e09');
    const routed = await tools.parseAndRoute(brud(
      call('adv_echo', 'file: e09.json', 'text: must not be written'),
    ), { callerContext: dispatchContext(root), dryRun: true });

    assert.equal(routed.status, 'success');
    assert.equal(routed.dispatched, 0);
    assert.equal(routed.failed, 0);
    assert.equal(routed.operations[0]?.status, 'success');
    await assertMissing(join(root, 'e09.json'));
  });

  it('E-10 dry-run still rejects an invalid schema', async (t) => {
    const { root, tools } = await bootAdversarial(t, 'e10');
    const routed = await tools.parseAndRoute(brud(
      call('adv_echo', 'text: missing the required file parameter'),
    ), { callerContext: dispatchContext(root), dryRun: true });

    assert.equal(routed.status, 'failed');
    assert.equal(routed.dispatched, 0);
    assert.equal(routed.failed, 1);
    assert.equal(routed.operations[0]?.status, 'schema_invalid');
    assert.match(String(routed.operations[0]?.error), /required property "file"/);
  });

  it('E-12 continues around an unknown tool between two valid tools', async (t) => {
    const { root, tools } = await bootAdversarial(t, 'e12');
    const routed = await tools.parseAndRoute(brud(
      call('adv_echo', 'file: e12-first.json', 'text: one'),
      call('adv_missing_tool', 'text: unknown'),
      call('adv_echo', 'file: e12-second.json', 'text: two'),
    ), { callerContext: dispatchContext(root) });

    assert.equal(routed.status, 'partial');
    assert.equal(routed.dispatched, 2);
    assert.equal(routed.failed, 1);
    assert.deepEqual(
      routed.operations.map((operation) => operation.status),
      ['success', 'tool_not_found', 'success'],
    );
    assert.match(String(routed.operations[1]?.error), /TOOL_NOT_FOUND/);
    const first = JSON.parse(await readFile(join(root, 'e12-first.json'), 'utf8'));
    const second = JSON.parse(await readFile(join(root, 'e12-second.json'), 'utf8'));
    assert.deepEqual(first, { text: 'one' });
    assert.deepEqual(second, { text: 'two' });
  });

  it('E-13 aggregates mixed successful and failed operations', async (t) => {
    const { root, tools } = await bootAdversarial(t, 'e13');
    const routed = await tools.parseAndRoute(brud(
      call('adv_echo', 'file: e13-success.json', 'text: ok'),
      call('adv_fail', 'text: nope'),
    ), { callerContext: dispatchContext(root) });

    assert.equal(routed.status, 'partial');
    assert.equal(routed.dispatched, 2);
    assert.equal(routed.failed, 1);
    assert.equal(routed.operations[0]?.status, 'success');
    assert.equal(routed.operations[1]?.status, 'failed');
    assert.equal(routed.operations[1]?.result?.status, 'failed');
    const written = JSON.parse(await readFile(join(root, 'e13-success.json'), 'utf8'));
    assert.deepEqual(written, { text: 'ok' });
  });
});

describe('D. Handler and error propagation', () => {
  it('H-01 normalizes a synchronous handler throw and continues the batch', async (t) => {
    const { root, tools } = await bootAdversarial(t, 'h01');
    const routed = await tools.parseAndRoute(brud(
      call('adv_throw_sync'),
      call('adv_echo', 'file: h01-after.json', 'text: after the throw'),
    ), { callerContext: dispatchContext(root) });

    assert.equal(routed.status, 'partial');
    assert.equal(routed.failed, 1);
    assert.equal(routed.operations[0]?.status, 'failed');
    assert.match(String(routed.operations[0]?.error), /^TOOL_HANDLER_ERROR: synchronous handler boom/);
    assert.equal(routed.operations[1]?.status, 'success');
    const written = JSON.parse(await readFile(join(root, 'h01-after.json'), 'utf8'));
    assert.deepEqual(written, { text: 'after the throw' });
  });

  it('H-02 normalizes an asynchronous handler rejection and continues the batch', async (t) => {
    const { root, tools } = await bootAdversarial(t, 'h02');
    const routed = await tools.parseAndRoute(brud(
      call('adv_throw_async'),
      call('adv_echo', 'file: h02-after.json', 'text: after the rejection'),
    ), { callerContext: dispatchContext(root) });

    assert.equal(routed.status, 'partial');
    assert.equal(routed.failed, 1);
    assert.equal(routed.operations[0]?.status, 'failed');
    assert.match(String(routed.operations[0]?.error), /^TOOL_HANDLER_ERROR: asynchronous handler boom/);
    assert.equal(routed.operations[1]?.status, 'success');
    const written = JSON.parse(await readFile(join(root, 'h02-after.json'), 'utf8'));
    assert.deepEqual(written, { text: 'after the rejection' });
  });

  it('H-03 treats an undefined handler return as a typed failure without crashing', async (t) => {
    const { root, tools } = await bootAdversarial(t, 'h03');
    const routed = await tools.parseAndRoute(brud(
      call('adv_undefined'),
      call('adv_echo', 'file: h03-after.json', 'text: after undefined'),
    ), { callerContext: dispatchContext(root) });

    assert.equal(routed.status, 'partial');
    assert.equal(routed.failed, 1);
    assert.equal(routed.operations[0]?.status, 'failed');
    assert.match(String(routed.operations[0]?.error), /^HANDLER_INVALID_RESULT: /);
    assert.equal(routed.operations[1]?.status, 'success');
  });

  it('H-05 rejects an unexpected handler result shape before aggregating', async (t) => {
    const { root, tools } = await bootAdversarial(t, 'h05');
    const routed = await tools.parseAndRoute(brud(
      call('adv_unexpected'),
    ), { callerContext: dispatchContext(root) });

    const outcome = routed.operations[0];

    assert.equal(routed.status, 'failed');
    assert.equal(routed.failed, 1);
    assert.equal(outcome?.status, 'failed');
    assert.match(String(outcome?.error), /^HANDLER_INVALID_RESULT: /);
    assert.equal(outcome?.result?.status, 'failed');
    assert.match(String(outcome?.result?.error), /^HANDLER_INVALID_RESULT: /);
  });

  it('H-07 reports a partial side effect when a handler writes then throws', async (t) => {
    const { root, tools } = await bootAdversarial(t, 'h07');
    const routed = await tools.parseAndRoute(brud(
      call('adv_write_then_throw', 'file: h07-partial.txt'),
    ), { callerContext: dispatchContext(root) });

    assert.equal(routed.status, 'failed');
    assert.equal(routed.failed, 1);
    assert.equal(routed.operations[0]?.status, 'failed');
    assert.match(String(routed.operations[0]?.error), /^TOOL_HANDLER_ERROR: failed after writing a file/);

    const partial = await readFile(join(root, 'h07-partial.txt'), 'utf8');
    assert.equal(partial, 'partial side effect');
  });

  it('H-09 isolates parser state from a handler that mutates its input', async (t) => {
    const { root, tools } = await bootAdversarial(t, 'h09');
    const document = brud(
      call('adv_mutate', 'text: alpha'),
      call('adv_mutate', 'text: beta'),
    );

    const first = await tools.parseAndRoute(document, { callerContext: dispatchContext(root) });
    const second = await tools.parseAndRoute(document, { callerContext: dispatchContext(root) });
    const parsed = tools.parseInput(document);

    assert.deepEqual(
      first.operations.map((operation) => operation.result?.data),
      [{ observed: 'alpha' }, { observed: 'beta' }],
    );
    assert.deepEqual(
      second.operations.map((operation) => operation.result?.data),
      [{ observed: 'alpha' }, { observed: 'beta' }],
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }
    assert.deepEqual(
      parsed.operations.map((operation) => operation.parameters.text),
      ['alpha', 'beta'],
    );
    assert.equal(Object.isFrozen(parsed.operations[0]?.parameters), true);
  });

  it('X-01 returns a structured parse error for a malformed document', async (t) => {
    const { root, tools } = await bootAdversarial(t, 'x01');
    const routed = await tools.parseAndRoute('there is no wrapper here', {
      callerContext: dispatchContext(root),
    });

    assert.equal(routed.status, 'failed');
    assert.equal(routed.dispatched, 0);
    assert.equal(routed.failed, 0);
    assert.equal(routed.operations.length, 0);
    assert.equal(routed.parseError?.code, 'PARSE_ERROR');
    assert.equal(typeof routed.parseError?.friendly, 'string');
    assert.equal(typeof routed.parseError?.details, 'string');
    assert.equal(typeof routed.parseError?.line, 'number');
  });

  it('X-02 returns a stable permission error code and does not run the handler', async (t) => {
    const { root, tools } = await bootAdversarial(t, 'x02');
    const routed = await tools.parseAndRoute(brud(
      call('adv_echo', 'file: x02-denied.json', 'text: denied'),
    ), { callerContext: dispatchContext(root, []) });

    assert.equal(routed.status, 'failed');
    assert.equal(routed.dispatched, 1);
    assert.equal(routed.failed, 1);
    assert.equal(routed.operations[0]?.status, 'failed');
    assert.match(String(routed.operations[0]?.result?.error), /^TOOL_PERMISSION_DENIED: /);
    await assertMissing(join(root, 'x02-denied.json'));
  });

  it('X-03 reports an unknown tool and runs no handler', async (t) => {
    const { root, tools } = await bootAdversarial(t, 'x03');
    const routed = await tools.parseAndRoute(brud(
      call('adv_missing_tool', 'file: x03.json', 'text: nope'),
    ), { callerContext: dispatchContext(root) });

    assert.equal(routed.status, 'failed');
    assert.equal(routed.dispatched, 0);
    assert.equal(routed.failed, 1);
    assert.equal(routed.operations[0]?.status, 'tool_not_found');
    assert.match(String(routed.operations[0]?.error), /^TOOL_NOT_FOUND: /);
    await assertMissing(join(root, 'x03.json'));
  });

  it('X-04 normalizes a handler exception without exposing its stack trace', async (t) => {
    const { root, tools } = await bootAdversarial(t, 'x04');
    const routed = await tools.parseAndRoute(brud(
      call('adv_throw_sync'),
    ), { callerContext: dispatchContext(root) });

    const error = String(routed.operations[0]?.error);

    assert.equal(routed.status, 'failed');
    assert.match(error, /^TOOL_HANDLER_ERROR: synchronous handler boom/);
    assert.equal(error.includes('SENSITIVE_STACK_FRAME'), false);
    assert.equal(/\n\s+at /.test(error), false);
  });
});