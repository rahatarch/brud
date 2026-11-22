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

/** Boot warnings the kernel reports. */
interface Warning {
  readonly message: string;
  readonly meta: Readonly<Record<string, unknown>> | undefined;
}

async function bootWith(
  declarations: readonly ContextScopeDeclaration[],
  options: Readonly<Record<string, unknown>> = {},
  warnings: Warning[] = [],
) {
  const configPath = join(root, 'brud.config.json');
  await writeFile(
    configPath,
    JSON.stringify({
      services: [
        { path: FIXTURE_PATH, official: true },
        { path: 'kernel:serviceModules/identityRegistry.js', official: true },
        { path: 'kernel:serviceModules/exposedApiRegistry.js', official: true },
        { path: 'kernel:serviceModules/parser.js', official: true },
        { path: 'kernel:serviceModules/router.js', official: true },
        { path: 'kernel:serviceModules/wasmCage.js', official: true },
        { path: 'kernel:serviceModules/events.js', official: true },
        { path: 'kernel:serviceModules/interception.js', official: true },
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
    logger: {
      debug: (): void => undefined,
      info: (): void => undefined,
      error: (): void => undefined,
      warn: (message: string, meta?: Readonly<Record<string, unknown>>): void => {
        warnings.push({ message, meta });
      },
    } as never,
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
      }, {
        name: 'exposedApi.scopeRecord.path',
        type: 'string',
        required: false,
        description: 'Absolute path to the protected exposed API scope record.',
        service: 'exposedApi',
      }]);
    } finally {
      await kernel.shutdown();
    }
  });

  it('refuses boot when a required field is missing, naming the field, the owner, the participant and the module', async () => {
    const warnings: Warning[] = [];

    await assert.rejects(
      bootWith([workspaceRootDeclaration()], {}, warnings),
      (error: unknown) => {
        assert.ok(error instanceof ContextContractError);
        assert.equal(error.field, 'workspace.root');
        assert.match(error.service ?? '', /contextContractService/u, 'the declaring owner is carried on the error');
        assert.match(error.message, /Boot refused/u);
        assert.match(error.message, /scope "workspace"/u);
        assert.match(error.message, /workspace\.root/u);
        assert.match(error.message, /test\.context\.contract/u, 'the participant is named');
        assert.match(error.message, /contextContractService/u, 'the module path is named');
        return true;
      },
    );
    assert.equal(
      warnings.some((warning) => Array.isArray(warning.meta?.['missingFields'])),
      false,
      'nothing is reported as pruned: there is no pruning',
    );
  });

  it('refuses boot when a hardcore service\'s required field is missing and names it', async () => {
    await assert.rejects(
      bootWith([], { 'identity.registry.path': undefined }),
      (error: unknown) => {
        assert.ok(error instanceof ContextContractError);
        assert.equal(error.field, 'identity.registry.path');
        assert.match(error.service ?? '', /identityRegistry/u);
        assert.match(error.message, /identity\.registry\.path/u);
        assert.match(error.message, /boot refused|missing/iu);
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
      assert.deepEqual(
        kernel.getContextSchema().fields.map((field) => field.name),
        ['workspace.label', 'identity.registry.path', 'exposedApi.scopeRecord.path'],
      );
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

    // Without the field the third-party participant refuses the boot; it never runs.
    await assert.rejects(
      bootWith([declaration]),
      (error: unknown) => error instanceof ContextContractError
        && error.field === 'photoshop.licenseKey'
        && /Boot refused.*scope "photoshop"/u.test(error.message),
    );

    // A wrong type is enforced for a declared field.
    await assert.rejects(
      bootWith([declaration], { 'photoshop.licenseKey': 42 }),
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
        'exposedApi.scopeRecord.path',
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
        ['workspace.root', 'identity.registry.path', 'exposedApi.scopeRecord.path'],
      );
    } finally {
      await kernel.shutdown();
    }
  });
});