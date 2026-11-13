import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootKernel } from '../bootstrap/index.js';
import { ContextContractError } from '../contracts/contextContract.js';
import type { ServiceContext } from '../contracts/lifecycle.js';
import type { IBrudToolsService } from '../../../services/BrudTools/contracts/IBrudToolsService.js';
import { BrudToolsToken } from '../../../services/BrudTools/descriptor/tokens.js';
import { identityRegistryContextOptions } from './support/workspaceContext.js';

const KERNEL_CONFIG_PATH = fileURLToPath(
  new URL('../../../services/standard.config.json', import.meta.url),
);
const DAEMON_CONFIG_PATH = fileURLToPath(
  new URL('../../../daemon/brud.config.json', import.meta.url),
);

interface RequiredField {
  readonly field: string;
  readonly service: string;
}

const REQUIRED_FIELDS: readonly RequiredField[] = [
  { field: 'workspace.root', service: 'workspace' },
  { field: 'settings.root', service: 'settings' },
  { field: 'filesystem.root', service: 'filesystem' },
  { field: 'terminal.root', service: 'terminal' },
  { field: 'pluginManager.root', service: 'pluginManager' },
  { field: 'history.root', service: 'history' },
  { field: 'router.root', service: 'router' },
  { field: 'identity.registry.path', service: 'identity' },
];

interface ProductionConfig {
  readonly services: readonly unknown[];
  readonly plugins: readonly unknown[];
}

let root = '';
let configRoot = '';
let workspaceRoot = '';
let kernelConfig: ProductionConfig;
let daemonConfig: ProductionConfig;

before(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'brud-production-context-')));
  configRoot = join(root, 'config');
  workspaceRoot = join(root, 'workspace');
  await mkdir(configRoot, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });

  kernelConfig = JSON.parse(
    await readFile(KERNEL_CONFIG_PATH, 'utf8'),
  ) as ProductionConfig;
  daemonConfig = JSON.parse(
    await readFile(DAEMON_CONFIG_PATH, 'utf8'),
  ) as ProductionConfig;

  assert.ok(kernelConfig.services.length > 0, 'kernel config must declare services');
  assert.ok(daemonConfig.services.length > 0, 'daemon config must declare services');
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

function contextBag(workspace: string): Record<string, unknown> {
  return {
    'workspace.root': workspace,
    'settings.root': workspace,
    'filesystem.root': workspace,
    'terminal.root': workspace,
    'pluginManager.root': workspace,
    'history.root': workspace,
    'router.root': workspace,
    ...identityRegistryContextOptions(workspace),
  };
}

async function writeConfig(name: string, config: unknown): Promise<string> {
  const directory = join(configRoot, name);
  await mkdir(directory, { recursive: true });
  const configPath = join(directory, 'brud.config.json');
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');

  return configPath;
}

function assertNamingError(
  error: unknown,
  expected: RequiredField,
): true {
  assert.ok(
    error instanceof ContextContractError,
    `expected ContextContractError for ${expected.field}, received ${error instanceof Error ? error.name : typeof error}`,
  );
  assert.equal(error.field, expected.field);
  assert.equal(error.service, expected.service);
  assert.equal(error.expectedType, 'string');
  assert.equal(error.actualType, 'missing');
  assert.match(error.message, new RegExp(expected.field.replace('.', '\\.'), 'u'));
  assert.match(error.message, new RegExp(`"${expected.service}"`, 'u'));
  assert.match(error.message, /Expected string/u);

  return true;
}

describe('production boot context contract', () => {
  for (const expected of REQUIRED_FIELDS) {
    it(`fails bootKernel from a real config when ${expected.field} is missing`, async () => {
      const bag = contextBag(workspaceRoot);
      delete bag[expected.field];

      const configPath = await writeConfig(
        `missing-${expected.field.replace('.', '-')}`,
        { services: kernelConfig.services, plugins: [] },
      );

      await assert.rejects(
        bootKernel(configPath, { options: bag }),
        (error: unknown) => assertNamingError(error, expected),
      );
    });
  }

  it('reports filesystem.root, not workspace.root, when only filesystem.root is missing', async () => {
    const bag = contextBag(workspaceRoot);
    delete bag['filesystem.root'];
    assert.equal(bag['workspace.root'], workspaceRoot);

    const configPath = await writeConfig('cross-service-filesystem', {
      services: kernelConfig.services,
      plugins: [],
    });

    await assert.rejects(
      bootKernel(configPath, { options: bag }),
      (error: unknown) => {
        assertNamingError(error, {
          field: 'filesystem.root',
          service: 'filesystem',
        });
        assert.ok(error instanceof ContextContractError);
        assert.doesNotMatch(error.message, /workspace\.root/u);

        return true;
      },
    );
  });

  it('boots the daemon config to RUNNING with the full bag and executes a real tool', async () => {
    const bag = contextBag(workspaceRoot);
    const configPath = await writeConfig('complete-daemon-config', daemonConfig);
    const probePath = join(workspaceRoot, 'production-mirror.txt');
    await writeFile(probePath, 'production mirror tool payload', 'utf8');

    const kernel = await bootKernel(configPath, {
      options: { ...bag, 'pluginManager.configPath': configPath },
    });

    try {
      assert.equal(kernel.lifecycleState, 'RUNNING');

      const caller: ServiceContext = {
        callerId: 'brud.host.daemon',
        tier: 'core',
        options: bag,
      };
      const tools = kernel.requestAccess<IBrudToolsService>(caller, BrudToolsToken);

      assert.ok(tools.listTools().length > 0, 'daemon config must register tools');

      const result = await tools.executeTool(
        'read_file',
        { filePath: 'production-mirror.txt' },
        {
          workspaceRoot,
          callerId: 'brud.host.daemon',
          permissions: ['fs:read', 'tools:execute'],
        },
      );

      assert.equal(result.status, 'success', JSON.stringify(result));
      const data = result.data as {
        readonly files?: readonly { readonly content?: string }[];
      };

      assert.equal(data.files?.[0]?.content, 'production mirror tool payload');
    } finally {
      await kernel.shutdown();
    }
  });
});