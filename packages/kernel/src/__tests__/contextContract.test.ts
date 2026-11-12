import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootKernel } from '../bootstrap/index.js';
import type { ContextFieldDeclaration, ContextScopeDeclaration } from '../contracts/contextContract.js';
import { ContextContractError } from '../contracts/contextContract.js';
import type { ServiceContext } from '../contracts/lifecycle.js';
import { createServiceToken } from '../contracts/serviceToken.js';
import { identityRegistryContextOptions } from './support/workspaceContext.js';

const FIXTURE_PATH = fileURLToPath(
  new URL('./fixtures/contextContractService.ts', import.meta.url),
);

interface ContractProbe {
  declare(scope: string, fields: readonly ContextFieldDeclaration[]): void;
}

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'brud-context-contract-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function bootWith(
  declarations: readonly ContextScopeDeclaration[],
  options: Readonly<Record<string, unknown>> = {},
) {
  const configPath = join(root, 'brud.config.json');
  await writeFile(
    configPath,
    JSON.stringify({
      services: [
        { path: FIXTURE_PATH },
        { path: 'kernel:serviceModules/identityRegistry.js', official: true },
      ],
      plugins: [],
    }),
    'utf8',
  );

  return bootKernel(configPath, {
    options: {
      __contractDeclarations: declarations,
      ...identityRegistryContextOptions(root),
      ...options,
    },
  });
}

function workspaceRootDeclaration(): ContextScopeDeclaration {
  return {
    scope: 'workspace',
    fields: [{
      name: 'workspace.root',
      type: 'string',
      required: true,
      description: 'Workspace root',
    }],
  };
}

function context(options: Readonly<Record<string, unknown>> = {}): ServiceContext {
  return { callerId: 'test.context.contract', tier: 'core', options };
}

describe('dynamic context contract', () => {
  it('collects a declaration into the introspectable schema', async () => {
    const kernel = await bootWith([workspaceRootDeclaration()], {
      'workspace.root': '/workspace/demo',
    });

    try {
      const schema = kernel.getContextSchema();

      assert.equal(schema.locked, true);
      assert.deepEqual(schema.fields, [{
        name: 'workspace.root',
        type: 'string',
        required: true,
        description: 'Workspace root',
        service: 'workspace',
      }, {
        name: 'identity.registry.path',
        type: 'string',
        required: true,
        description: 'Absolute path to the operator-provisioned identity registry file.',
        service: 'identity',
      }]);
    } finally {
      await kernel.shutdown();
    }
  });

  it('rejects boot when a required field is missing and names it', async () => {
    await assert.rejects(
      bootWith([workspaceRootDeclaration()]),
      (error: unknown) => {
        assert.ok(error instanceof ContextContractError);
        assert.equal(error.field, 'workspace.root');
        assert.equal(error.service, 'workspace');
        assert.equal(error.expectedType, 'string');
        assert.equal(error.actualType, 'missing');
        assert.match(error.message, /workspace\.root/u);
        assert.match(error.message, /"workspace"/u);
        assert.match(error.message, /Expected string/u);
        return true;
      },
    );
  });

  it('rejects boot when a declared field has the wrong type', async () => {
    await assert.rejects(
      bootWith([workspaceRootDeclaration()], { 'workspace.root': 42 }),
      (error: unknown) => {
        assert.ok(error instanceof ContextContractError);
        assert.equal(error.field, 'workspace.root');
        assert.equal(error.service, 'workspace');
        assert.equal(error.expectedType, 'string');
        assert.equal(error.actualType, 'number');
        assert.match(error.message, /must be of type string/u);
        assert.match(error.message, /received number/u);
        return true;
      },
    );
  });

  it('rejects a flat legacy key even when the namespaced field is present', async () => {
    await assert.rejects(
      bootWith([workspaceRootDeclaration()], {
        'workspace.root': '/workspace/demo',
        workspaceRoot: '/workspace/demo',
      }),
      (error: unknown) => {
        assert.ok(error instanceof ContextContractError);
        assert.equal(error.field, 'workspaceRoot');
        assert.match(error.message, /Un-namespaced string context option "workspaceRoot"/u);
        return true;
      },
    );
  });

  it('rejects a bag that supplies only the flat legacy key', async () => {
    await assert.rejects(
      bootWith([workspaceRootDeclaration()], {
        workspaceRoot: '/workspace/demo',
      }),
      (error: unknown) => {
        assert.ok(error instanceof ContextContractError);
        assert.equal(error.field, 'workspaceRoot');
        assert.match(error.message, /workspaceRoot/u);
        return true;
      },
    );
  });

  it('accepts an absent optional field but rejects a present wrong type', async () => {
    const declaration: ContextScopeDeclaration = {
      scope: 'workspace',
      fields: [{
        name: 'workspace.label',
        type: 'string',
        required: false,
        description: 'Optional label',
      }],
    };

    const kernel = await bootWith([declaration]);

    try {
      assert.equal(kernel.getContextSchema().fields.length, 2);
    } finally {
      await kernel.shutdown();
    }

    await assert.rejects(
      bootWith([declaration], { 'workspace.label': false }),
      (error: unknown) => {
        assert.ok(error instanceof ContextContractError);
        assert.equal(error.field, 'workspace.label');
        assert.equal(error.actualType, 'boolean');
        return true;
      },
    );
  });

  it('rejects a field declared outside the service namespace', async () => {
    await assert.rejects(
      bootWith([{
        scope: 'workspace',
        fields: [{
          name: 'photoshop.licenseKey',
          type: 'string',
          required: true,
          description: 'Foreign field',
        }],
      }], { 'photoshop.licenseKey': 'abc' }),
      (error: unknown) => {
        assert.ok(error instanceof ContextContractError);
        assert.equal(error.field, 'photoshop.licenseKey');
        assert.equal(error.service, 'workspace');
        assert.match(error.message, /cannot declare field "photoshop\.licenseKey"/u);
        assert.match(error.message, /"workspace\." namespace/u);
        return true;
      },
    );
  });

  it('lets an unknown third-party namespace declare and enforce its own field', async () => {
    const declaration: ContextScopeDeclaration = {
      scope: 'photoshop',
      fields: [{
        name: 'photoshop.licenseKey',
        type: 'string',
        required: true,
        description: 'Third-party license key',
      }],
    };

    await assert.rejects(
      bootWith([declaration]),
      (error: unknown) => {
        assert.ok(error instanceof ContextContractError);
        assert.equal(error.field, 'photoshop.licenseKey');
        assert.equal(error.service, 'photoshop');
        return true;
      },
    );

    const kernel = await bootWith([declaration], {
      'photoshop.licenseKey': 'license-abc',
    });

    try {
      const schema = kernel.getContextSchema();

      assert.deepEqual(schema.fields.map((field) => field.name), [
        'photoshop.licenseKey',
        'identity.registry.path',
      ]);
      assert.equal(schema.fields[0]?.service, 'photoshop');
    } finally {
      await kernel.shutdown();
    }
  });

  it('rejects declarations made after the kernel reaches RUNNING', async () => {
    const kernel = await bootWith([workspaceRootDeclaration()], {
      'workspace.root': '/workspace/demo',
    });

    try {
      const token = createServiceToken<ContractProbe>(
        'test.context.contract',
        'Late declaration probe',
      );
      const service = kernel.requestAccess(context({ 'workspace.root': '/workspace/demo' }), token);

      assert.equal(kernel.lifecycleState, 'RUNNING');
      assert.throws(
        () => service.declare('workspace', [{
          name: 'workspace.late',
          type: 'string',
          required: false,
          description: 'Late field',
        }]),
        (error: unknown) => {
          assert.ok(error instanceof ContextContractError);
          assert.equal(error.service, 'workspace');
          assert.match(error.message, /locked/u);
          assert.match(error.message, /RUNNING/u);
          return true;
        },
      );

      assert.deepEqual(
        kernel.getContextSchema().fields.map((field) => field.name),
        ['workspace.root', 'identity.registry.path'],
      );
    } finally {
      await kernel.shutdown();
    }
  });
});