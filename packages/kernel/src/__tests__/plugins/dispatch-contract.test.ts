import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OperationResult } from '../../contracts/handler.js';
import { BrudToolsToken } from '../../../services/BrudTools/descriptor/tokens.js';
import type {
  IBrudToolsService,
  IPluginExecutionContext,
} from '../../../services/BrudTools/contracts/IBrudToolsService.js';
import { bootRealKernel } from '../support/realKernel.js';

const STRICT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    foo: { type: 'string' },
  },
  required: ['foo'],
  additionalProperties: false,
};

const LEGACY_ARTIFACT_PATTERN = /index|MISSING_FIELD|MISSING_INDEX|UNKNOWN_OPERATION|21-kind/iu;

describe('dynamic dispatch contract invariant', () => {
  it('validates exactly against the registered schema and never requires an index', async (t) => {
    const { kernel, root } = await bootRealKernel(t, {
      prefix: 'brud-dispatch-contract-',
    });

    const tools = kernel.requestAccess<IBrudToolsService>(
      { callerId: 'test.dispatch-contract', tier: 'core', options: { workspaceRoot: root } },
      BrudToolsToken,
    );
    const context: IPluginExecutionContext = {
      workspaceRoot: root,
      callerId: 'test.dispatch-contract',
    };
    const executed: unknown[] = [];

    tools.registerTool('test.dispatch-contract', false, {
      name: 'schema_only_tool',
      description: 'A tool whose only input contract is its registered JSON Schema.',
      parametersSchema: STRICT_SCHEMA,
      execute: async (input): Promise<OperationResult> => {
        executed.push(input);

        return { status: 'success', data: input };
      },
    });

    const valid = await tools.executeTool('schema_only_tool', { foo: 'bar' }, context);

    assert.equal(valid.status, 'success');
    assert.deepEqual(valid.data, { foo: 'bar' });
    assert.equal(executed.length, 1, 'the handler must run exactly once for the valid payload');

    const missing = await tools.executeTool('schema_only_tool', {}, context);

    assert.equal(missing.status, 'failed');
    assert.match(String(missing.error), /^TOOL_VALIDATION_ERROR: /);
    assert.match(String(missing.error), /required/u);

    const additional = await tools.executeTool(
      'schema_only_tool',
      { foo: 'bar', extra: 'x' },
      context,
    );

    assert.equal(additional.status, 'failed');
    assert.match(String(additional.error), /^TOOL_VALIDATION_ERROR: /);
    assert.match(String(additional.error), /additional properties/u);

    const wrongType = await tools.executeTool('schema_only_tool', { foo: 123 }, context);

    assert.equal(wrongType.status, 'failed');
    assert.match(String(wrongType.error), /^TOOL_VALIDATION_ERROR: /);
    assert.match(String(wrongType.error), /string/u);

    const unknown = await tools.executeTool('no_such_tool', {}, context);

    assert.equal(unknown.status, 'failed');
    assert.match(String(unknown.error), /^TOOL_NOT_FOUND: /);

    for (const result of [missing, additional, wrongType, unknown]) {
      const message = String(result.error);

      assert.doesNotMatch(
        message,
        LEGACY_ARTIFACT_PATTERN,
        `dispatch errors must not mention an index or operation kind: ${message}`,
      );
    }

    assert.equal(
      executed.length,
      1,
      'only schema-valid payloads may reach the handler',
    );
  });
});