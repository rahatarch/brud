import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OperationResult } from '../../src/contracts/handler.js';
import type { ServiceContext } from '../../src/contracts/lifecycle.js';
import { compileJsonSchema } from '../../services/ValidationService/engine/jsonSchema/index.js';
import type { IBrudToolsService } from '../../services/BrudTools/contracts/IBrudToolsService.js';
import { BrudToolsToken } from '../../services/BrudTools/descriptor/tokens.js';
import type { BrudOperation } from '../../services/Parser/contracts/index.js';
import { synthesizeIndex } from '../../services/Parser/parser/indexSynthesis.js';
import type { BrudOperationKind } from '../../src/contracts/brudOperation.js';
import { ValidationToken } from '../../services/ValidationService/descriptor/tokens.js';
import type { IValidationService } from '../../services/ValidationService/contracts/IValidationService.js';
import type { ValidationService } from '../../services/ValidationService/orchestrator/ValidationService.js';
import type { IBrudPlugin } from '../../services/PluginManager/contracts/IBrudPlugin.js';
import { bootRealKernel } from './support/realKernel.js';
import { workspaceContextOptions } from './support/workspaceContext.js';

function caller(root: string): ServiceContext {
  return { callerId: 'purification', tier: 'core', options: {...workspaceContextOptions(root)} };
}

function toolPlugin(
  id: string,
  toolName: string,
  schema: Record<string, unknown>,
): IBrudPlugin {
  return {
    manifest: {
      id,
      name: id,
      version: '1.0.0',
      permissions: ['tools:register', 'tools:execute', 'fs:read', 'fs:write'],
    },
    activate: (context): void => {
      context.registerTool({
        name: toolName,
        description: `${toolName} description`,
        parametersSchema: schema,
        execute: async (input): Promise<OperationResult> => ({ status: 'success', data: input }),
      });
    },
  };
}

describe('P0-1 protected annotation', () => {
  it('compileJsonSchema accepts protected: true at the root and nested', () => {
    const root = compileJsonSchema({
      type: 'object',
      protected: true,
      properties: { content: { type: 'string', protected: true } },
      required: ['content'],
    });

    assert.equal(root.ok, true);

    const nested = compileJsonSchema({
      type: 'object',
      properties: {
        list: { type: 'array', items: { type: 'string', protected: true } },
        choice: { oneOf: [{ type: 'string', protected: true }, { type: 'number' }] },
      },
    });

    assert.equal(nested.ok, true);
  });

  it('protected does not change validation', () => {
    const result = compileJsonSchema({
      type: 'object',
      properties: { content: { type: 'string', protected: true } },
      required: ['content'],
    });

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.deepEqual(result.schema.validate({ content: 'x' }), { valid: true });

    const missing = result.schema.validate({});
    assert.equal(missing.valid, false);
    if (!missing.valid) {
      assert.ok(missing.violations.some((violation) => violation.keyword === 'required'));
      assert.ok(!missing.violations.some((violation) => String(violation.keyword) === 'protected'));
    }
  });

  it('a tool with a protected schema registers and executes', async (t) => {
    const plugin = toolPlugin('acme.protected', 'protected_tool', {
      type: 'object',
      properties: { content: { type: 'string', protected: true } },
      required: ['content'],
    });
    const { kernel, root } = await bootRealKernel(t, {
      prefix: 'brud-purification-protected-',
      initialPlugins: [plugin],
    });

    const tools = kernel.requestAccess<IBrudToolsService>(caller(root), BrudToolsToken);
    const result = await tools.executeTool('protected_tool', { content: 'body' }, {
      workspaceRoot: root,
      callerId: 'acme.protected',
      permissions: ['fs:read'],
    });

    assert.equal(result.status, 'success');
  });

  it('unknown schema keywords still fail closed', () => {
    const result = compileJsonSchema({ type: 'object', mystery: true });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((error) => error.code === 'UNSUPPORTED_KEYWORD'));
    }
  });
});

describe('P0-3 open tool identity', () => {
  it('a non-21 tool name is a first-class identity', async (t) => {
    const plugin = toolPlugin('acme.synthetic', 'synthetic_probe_tool', {
      type: 'object',
      properties: { value: { type: 'string' } },
    });
    const { kernel, root } = await bootRealKernel(t, {
      prefix: 'brud-purification-open-identity-',
      initialPlugins: [plugin],
    });

    const tools = kernel.requestAccess<IBrudToolsService>(caller(root), BrudToolsToken);
    const result = await tools.executeTool('synthetic_probe_tool', { value: 'hello' }, {
      workspaceRoot: root,
      callerId: 'acme.synthetic',
      permissions: ['fs:read'],
    });

    assert.equal(result.status, 'success');
    assert.equal(tools.getTool('synthetic_probe_tool')?.ownerPluginId, 'acme.synthetic');
  });

  it('BrudOperationKind is open at compile time', () => {
    const kind: BrudOperationKind = 'synthetic_probe_tool';

    assert.equal(kind, 'synthetic_probe_tool');
  });

  it('a parsed operation carries the shared kind field', () => {
    const operation: BrudOperation = {
      index: '1',
      kind: 'tool',
      name: 'synthetic_probe_tool',
      parameters: Object.freeze({}),
    };

    assert.equal(operation.kind, 'tool');
    assert.equal(operation.name, 'synthetic_probe_tool');
  });
});

describe('P0-4 synthesized index', () => {
  it('synthesizeIndex is 1-based', () => {
    assert.equal(synthesizeIndex(0), '1');
    assert.equal(synthesizeIndex(1), '2');
    assert.equal(synthesizeIndex(99), '100');
  });

  it('the synthesized index satisfies the frozen matrix', async (t) => {
    const { kernel, root } = await bootRealKernel(t, { prefix: 'brud-purification-index-' });
    const validation = kernel.requestAccess<IValidationService>(caller(root), ValidationToken) as ValidationService;
    const decision = validation.validateInput('read_file', {
      index: synthesizeIndex(0),
      path: 'a.ts',
    });

    assert.equal(decision.ok, true);
  });
});

describe('P0-5 validateFormat', () => {
  it('accepts a balanced [BRUD] wrapper', async (t) => {
    const { kernel, root } = await bootRealKernel(t, { prefix: 'brud-purification-format-' });
    const validation = kernel.requestAccess<IValidationService>(caller(root), ValidationToken) as ValidationService;
    const decision = validation.validateFormat(
      '[BRUD]\n[CALL read_file]\npath: a.ts\n[END]\n[/BRUD]',
    );

    assert.equal(decision.ok, true);
  });

  it('rejects merge markers', async (t) => {
    const { kernel, root } = await bootRealKernel(t, { prefix: 'brud-purification-merge-' });
    const validation = kernel.requestAccess<IValidationService>(caller(root), ValidationToken) as ValidationService;
    const decision = validation.validateFormat(
      '<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE',
    );

    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.code, 'PARSE_ERROR');
    }
  });

  it('rejects a reversed wrapper', async (t) => {
    const { kernel, root } = await bootRealKernel(t, { prefix: 'brud-purification-reversed-' });
    const validation = kernel.requestAccess<IValidationService>(caller(root), ValidationToken) as ValidationService;
    const decision = validation.validateFormat('[/BRUD]\n[BRUD]');

    assert.equal(decision.ok, false);
  });
});