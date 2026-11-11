import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import type { IPluginContext } from '../contracts/IPluginContext.js';
import type { PluginPermission } from '../contracts/permissions.js';
import { CAPABILITY_PERMISSION_REQUIREMENTS } from '../contracts/permissions.js';
import type { ITerminalHandle } from '../contracts/ITerminalHandle.js';
import { PluginManagerToken } from '../contracts/tokens.js';
import type {
  TerminalResult,
  TerminalRunOutcome,
} from '../../TerminalService/contracts/ITerminalService.js';
import { TerminalToken } from '../../TerminalService/descriptor/tokens.js';
import { bootKernel } from '../../../src/bootstrap/index.js';
import type { BrudKernel } from '../../../src/engine/BrudKernel.js';
import { workspaceContextOptions } from '../../../src/__tests__/support/workspaceContext.js';

const KERNEL_CONFIG_PATH = fileURLToPath(
  new URL('../../../brud.config.json', import.meta.url),
);

interface KernelConfig {
  readonly services: readonly { readonly path: string }[];
}

interface PluginModule {
  getContext(): IPluginContext | undefined;
}

interface PluginPackage {
  readonly entry: string;
  readonly module: PluginModule;
}

function pluginSource(id: string, permissions: readonly PluginPermission[]): string {
  return `let captured;
export function getContext() {
  return captured;
}
export const plugin = {
  manifest: {
    id: ${JSON.stringify(id)},
    name: ${JSON.stringify(id)},
    version: '1.0.0',
    permissions: ${JSON.stringify(permissions)},
  },
  activate(context) {
    captured = context;
  },
};
`;
}

async function writePluginPackage(
  directory: string,
  id: string,
  permissions: readonly PluginPermission[],
): Promise<PluginPackage> {
  await mkdir(directory, { recursive: true });
  const entry = join(directory, 'index.mjs');
  await writeFile(entry, pluginSource(id, permissions), 'utf8');
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ name: id, version: '1.0.0', type: 'module', main: './index.mjs' }, null, 2),
    'utf8',
  );

  const module = await import(pathToFileURL(entry).href) as PluginModule;

  return { entry, module };
}

async function writeConfig(
  directory: string,
  config: unknown,
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const configPath = join(directory, 'brud.config.json');
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');

  return configPath;
}

function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  return new Promise<void>((resolve, reject) => {
    const poll = (): void => {
      if (predicate()) {
        resolve();
        return;
      }

      if (Date.now() >= deadline) {
        reject(new Error('condition was not met before the deadline'));
        return;
      }

      setTimeout(poll, 10);
    };

    poll();
  });
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}

let root = '';
let workspaceRoot = '';
let kernel: BrudKernel;
let kernelServices: KernelConfig['services'];
let without: PluginPackage;
let first: PluginPackage;
let second: PluginPackage;

function contextOf(plugin: PluginPackage): IPluginContext {
  const context = plugin.module.getContext();
  assert.ok(context !== undefined, `${plugin.entry} did not capture a plugin context`);

  return context;
}

function handleOf(plugin: PluginPackage): ITerminalHandle {
  const handle = contextOf(plugin).getTerminal();
  assert.ok(handle !== null, `${plugin.entry} did not receive a terminal handle`);

  return handle;
}

function singleOutcome(result: TerminalResult): TerminalRunOutcome {
  assert.ok('output' in result, 'a single command must resolve to a run outcome');

  return result;
}

before(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'brud-terminal-capability-')));
  workspaceRoot = join(root, 'workspace');
  await mkdir(workspaceRoot, { recursive: true });
  workspaceRoot = await realpath(workspaceRoot);

  const pluginRoot = join(root, 'plugins');
  without = await writePluginPackage(join(pluginRoot, 'without'), 'acme.terminal.without', ['fs:read']);
  first = await writePluginPackage(join(pluginRoot, 'first'), 'acme.terminal.first', ['terminal:execute']);
  second = await writePluginPackage(join(pluginRoot, 'second'), 'acme.terminal.second', ['terminal:execute']);
  const production = JSON.parse(await readFile(KERNEL_CONFIG_PATH, 'utf8')) as KernelConfig;
  assert.ok(production.services.length > 0, 'kernel config must declare services');
  kernelServices = production.services;

  const configPath = await writeConfig(join(root, 'config'), {
    services: kernelServices,
    plugins: [
      { path: without.entry },
      { path: first.entry },
      { path: second.entry },
    ],
  });

  kernel = await bootKernel(configPath, { options: workspaceContextOptions(workspaceRoot) });
});

after(async () => {
  await kernel.shutdown();
  await rm(root, { recursive: true, force: true });
});

describe('terminal plugin capability', () => {
  it('maps the terminal capability to terminal:execute', () => {
    assert.deepEqual(CAPABILITY_PERMISSION_REQUIREMENTS.terminal, ['terminal:execute']);
  });

  it('returns null when terminal:execute is not declared', () => {
    const context = contextOf(without);

    assert.equal(context.getTerminal(), null);
    assert.equal(context.getTerminal(), null);
  });

  it('returns a scoped handle when terminal:execute is declared', async () => {
    const context = contextOf(first);
    const handle = context.getTerminal();

    assert.ok(handle !== null);
    assert.equal(handle, context.getTerminal(), 'the handle must be memoized');

    const result = singleOutcome(await handle.run({ command: 'echo hi' }));

    assert.equal(result.success, true, result.output);

    const printed = singleOutcome(await handle.run({ command: 'pwd' }));
    assert.equal(printed.success, true, printed.output);
    assert.equal(await realpath(printed.output.trim()), workspaceRoot);
  });

  it('only lists, cancels, and disposes executions owned by the plugin', async () => {
    const firstHandle = handleOf(first);
    const secondHandle = handleOf(second);

    const firstRun = firstHandle.run({ command: 'exec sleep 30' }).catch(() => undefined);
    await waitFor(() => firstHandle.list().length === 1);
    const firstSession = firstHandle.list()[0];
    assert.ok(firstSession !== undefined);
    assert.equal(firstSession.callerId, 'acme.terminal.first');

    const secondRun = secondHandle.run({ command: 'exec sleep 30' }).catch(() => undefined);
    await waitFor(() => secondHandle.list().length === 1);
    const secondSession = secondHandle.list()[0];
    assert.ok(secondSession !== undefined);
    assert.equal(secondSession.callerId, 'acme.terminal.second');

    assert.equal(
      firstHandle.list().some((session) => session.executionId === secondSession.executionId),
      false,
      'another plugin session must stay invisible',
    );
    assert.equal(
      secondHandle.list().some((session) => session.executionId === firstSession.executionId),
      false,
    );

    await secondHandle.cancel(firstSession.executionId);
    await delay(50);
    assert.equal(
      firstHandle.list().some((session) => session.executionId === firstSession.executionId),
      true,
      'another plugin must not be able to cancel this session',
    );

    await firstHandle.cancel(firstSession.executionId);
    await waitFor(() => firstHandle.list().length === 0);
    await firstRun;

    const disposeRun = firstHandle.run({ command: 'exec sleep 30' }).catch(() => undefined);
    await waitFor(() => firstHandle.list().length === 1);

    await firstHandle.dispose();
    await waitFor(() => firstHandle.list().length === 0);
    await disposeRun;

    assert.equal(
      secondHandle.list().some((session) => session.executionId === secondSession.executionId),
      true,
      'disposing one plugin handle must not dispose another plugin',
    );

    await secondHandle.dispose();
    await waitFor(() => secondHandle.list().length === 0);
    await secondRun;
  });

  it('boots a real kernel without the terminal service', async () => {
    const configPath = await writeConfig(join(root, 'config-no-terminal'), {
      services: kernelServices.filter((service) => !service.path.endsWith('/terminal.js')),
      plugins: [{ path: first.entry }],
    });

    const terminalFreeKernel = await bootKernel(configPath, {
      options: workspaceContextOptions(workspaceRoot),
    });

    try {
      assert.equal(terminalFreeKernel.lifecycleState, 'RUNNING');
      assert.equal(
        terminalFreeKernel.hasService(TerminalToken),
        false,
        'the terminal service must be absent from this composition',
      );

      const manager = terminalFreeKernel.requestAccess(
        {
          callerId: 'terminal-free-proof',
          tier: 'core',
          options: workspaceContextOptions(workspaceRoot),
        },
        PluginManagerToken,
      );

      assert.equal(manager.getPlugin('acme.terminal.first')?.state, 'active');
      assert.equal(contextOf(first).getTerminal(), null);
    } finally {
      await terminalFreeKernel.shutdown();
    }
  });
});