import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OperationResult } from '../contracts/handler.js';
import type {
  IPluginExecutionContext,
  ToolRegistrationOptions,
} from '../../../services/BrudTools/contracts/IBrudToolsService.js';
import { ParserRouterHarness } from './support/parserRouterHarness.js';

const CONTEXT: IPluginExecutionContext = {
  workspaceRoot: '/workspace',
  callerId: 'parser-test',
};

function tool(
  name: string,
  parametersSchema: Record<string, unknown>,
  execute?: ToolRegistrationOptions['execute'],
): ToolRegistrationOptions {
  return {
    name,
    description: `${name} test tool`,
    parametersSchema,
    execute: execute ?? (async (input): Promise<OperationResult> => ({
      status: 'success',
      data: input,
    })),
  };
}

describe('Brud Protocol v2 parser', () => {
  it('parses a valid [BRUD] block with a simple tool call', () => {
    const service = new ParserRouterHarness();
    service.registerTool('brud.tools.test', true, tool('echo', {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    }));

    const result = service.parseInput([
      'Here is the operation:',
      '[BRUD]',
      '[CALL echo]',
      'text: hello world',
      '[END]',
      '[/BRUD]',
    ].join('\n'));

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.equal(result.operations.length, 1);
    assert.equal(result.operations[0]?.index, '1');
    assert.equal(result.operations[0]?.toolName, 'echo');
    assert.deepEqual(result.operations[0]?.parameters, { text: 'hello world' });
  });

  it('parses multiple [CALL] blocks in document order', () => {
    const service = new ParserRouterHarness();
    service.registerTool('brud.tools.test', true, tool('echo', {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    }));
    service.registerTool('brud.tools.test', true, tool('count', {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
    }));

    const result = service.parseInput([
      '[BRUD]',
      '[CALL echo]',
      'text: one',
      '[END]',
      '',
      '[CALL count]',
      'value: two',
      '[END]',
      '[/BRUD]',
    ].join('\n'));

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.equal(result.operations.length, 2);
    assert.deepEqual(
      result.operations.map((operation) => [operation.index, operation.toolName]),
      [['1', 'echo'], ['2', 'count']],
    );
    assert.deepEqual(result.operations[0]?.parameters, { text: 'one' });
    assert.deepEqual(result.operations[1]?.parameters, { value: 'two' });
  });

  it('treats a {protected} region as literal and does not execute inner [CALL] markers', async () => {
    const service = new ParserRouterHarness();
    const calls: Record<string, unknown>[] = [];

    service.registerTool('brud.tools.filesystem', true, tool('create_file', {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string', protected: true },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    }, async (input): Promise<OperationResult> => {
      calls.push(input);

      return { status: 'success', data: input };
    }));

    const raw = [
      '[BRUD]',
      '[CALL create_file]',
      'path: src/config.ts',
      '{content}',
      'export const config = {};',
      '[CALL ignored]',
      'value: 1',
      '[END]',
      '{/content}',
      '[END]',
      '[/BRUD]',
    ].join('\n');

    const parsed = service.parseInput(raw);

    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }

    assert.equal(parsed.operations.length, 1);
    assert.equal(
      parsed.operations[0]?.parameters.content,
      'export const config = {};\n[CALL ignored]\nvalue: 1\n[END]',
    );

    const routed = await service.parseAndRoute(raw, { callerContext: CONTEXT });

    assert.equal(routed.status, 'success');
    assert.equal(calls.length, 1);
    assert.equal(
      (calls[0]?.content as string).includes('[CALL ignored]'),
      true,
    );
  });

  it('routes end-to-end: parses, validates against the registered schema and executes', async () => {
    const service = new ParserRouterHarness();
    let invocations = 0;
    let observedIndex: unknown = 'not-called';

    service.registerTool('brud.tools.test', true, tool('echo', {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    }, async (input): Promise<OperationResult> => {
      invocations += 1;
      observedIndex = input.index;

      return {
        status: 'success',
        data: { text: input.text },
      };
    }));

    const result = await service.parseAndRoute([
      '[BRUD]',
      '[CALL echo]',
      'text: routed',
      '[END]',
      '[/BRUD]',
    ].join('\n'), { callerContext: CONTEXT });

    assert.equal(result.status, 'success');
    assert.equal(result.dispatched, 1);
    assert.equal(result.failed, 0);
    assert.equal(invocations, 1);

    const outcome = result.operations[0];

    assert.equal(outcome?.status, 'success');
    assert.equal(outcome?.operationIndex, '1');
    assert.equal(observedIndex, undefined, 'the protocol index must not be injected into handler input');
    assert.deepEqual(outcome?.result?.data, { text: 'routed' });
  });
});