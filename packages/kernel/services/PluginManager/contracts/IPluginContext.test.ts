import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { IBrudFileSystem } from '../../BrudFileSystem/contracts/index.js';
import type { IUniversalHistoryService } from '../../UniversalHistory/contracts/index.js';
import type { NamespaceHistoryHandle } from '../../UniversalHistory/unified/service/types.js';
import { PluginPermissionError } from './errors.js';
import type { IPluginLogger, IPluginSubscriptions } from './IPluginContext.js';
import { PluginContext } from './PluginContext.js';
import type { PluginCapabilityProviders } from './PluginContext.js';
import type { PluginPermission } from './permissions.js';
import { PluginSubscriptions } from './PluginSubscriptions.js';

class UnusedFileSystem implements IBrudFileSystem {
  async readFile(): Promise<never> {
    throw new Error('filesystem facade is not used in this test');
  }

  async readText(): Promise<never> {
    throw new Error('filesystem facade is not used in this test');
  }

  async writeAtomic(): Promise<never> {
    throw new Error('filesystem facade is not used in this test');
  }

  async createFile(): Promise<never> {
    throw new Error('filesystem facade is not used in this test');
  }

  async deleteFile(): Promise<never> {
    throw new Error('filesystem facade is not used in this test');
  }

  async readDirectory(): Promise<never> {
    throw new Error('filesystem facade is not used in this test');
  }

  async stat(): Promise<never> {
    throw new Error('filesystem facade is not used in this test');
  }

  async exists(): Promise<never> {
    throw new Error('filesystem facade is not used in this test');
  }
}

class UnusedUniversalHistory implements IUniversalHistoryService {
  async beginSession(): Promise<never> {
    throw new Error('history facade is not used in this test');
  }

  async commitSession(): Promise<never> {
    throw new Error('history facade is not used in this test');
  }

  async planReversal(): Promise<never> {
    throw new Error('history facade is not used in this test');
  }

  async executeReversal(): Promise<never> {
    throw new Error('history facade is not used in this test');
  }

  async getSession(): Promise<never> {
    throw new Error('history facade is not used in this test');
  }

  async listSessions(): Promise<never> {
    throw new Error('history facade is not used in this test');
  }
}

class RecordingLogger implements IPluginLogger {
  public readonly messages: string[] = [];

  info(message: string): void {
    this.messages.push(`info:${message}`);
  }

  warn(message: string): void {
    this.messages.push(`warn:${message}`);
  }

  error(message: string): void {
    this.messages.push(`error:${message}`);
  }
}

interface ProviderCounts {
  fileSystem: number;
  universalHistory: number;
  history?: number;
}

let disposedEntryTypes = 0;
const UNUSED_NAMESPACE_HANDLE = Object.freeze({
  namespace: 'brud.tools.core',
  registerEntryType: () => ({ dispose: (): void => void (disposedEntryTypes += 1) }),
}) as unknown as NamespaceHistoryHandle;

function createProviders(counts: ProviderCounts): PluginCapabilityProviders {
  const fileSystem = new UnusedFileSystem();
  const universalHistory = new UnusedUniversalHistory();

  return {
    fileSystem: (): IBrudFileSystem => {
      counts.fileSystem += 1;
      return fileSystem;
    },
    universalHistory: (): IUniversalHistoryService => {
      counts.universalHistory += 1;
      return universalHistory;
    },
    history: (): NamespaceHistoryHandle => {
      counts.history = (counts.history ?? 0) + 1;
      return UNUSED_NAMESPACE_HANDLE;
    },
  };
}

function createContext(
  permissions: readonly PluginPermission[],
  counts: ProviderCounts = { fileSystem: 0, universalHistory: 0 },
  official = false,
): PluginContext {
  return new PluginContext({
    pluginId: 'brud.tools.core',
    workspaceRoot: '/workspace',
    permissions,
    official,
    logger: new RecordingLogger(),
    capabilities: createProviders(counts),
  });
}

describe('IPluginContext contract', () => {
  it('exposes the manifest-scoped identity and permission set', () => {
    const context = createContext(['fs:read', 'tools:register']);

    assert.equal(context.pluginId, 'brud.tools.core');
    assert.equal(context.workspaceRoot, '/workspace');
    assert.deepEqual([...context.permissions], ['fs:read', 'tools:register']);
    assert.equal(context.hasPermission('fs:read'), true);
    assert.equal(context.hasPermission('fs:write'), false);
  });

  it('provides a default reverse-order subscription registry', async () => {
    const context = createContext([]);

    assert.ok(context.subscriptions instanceof PluginSubscriptions);

    const order: string[] = [];
    context.subscriptions.add({ dispose: (): void => void order.push('first') });
    context.subscriptions.add({ dispose: (): void => void order.push('second') });

    await context.subscriptions.disposeAll();

    assert.deepEqual(order, ['second', 'first']);
  });

  it('accepts a manager-supplied logger and subscription registry', () => {
    const logger = new RecordingLogger();
    const subscriptions: IPluginSubscriptions = new PluginSubscriptions();
    const context = new PluginContext({
      pluginId: 'brud.tools.core',
      workspaceRoot: '/workspace',
      permissions: [],
      logger,
      subscriptions,
      capabilities: createProviders({ fileSystem: 0, universalHistory: 0 }),
    });

    assert.equal(context.logger, logger);
    assert.equal(context.subscriptions, subscriptions);
  });

  it('denies filesystem access when no filesystem permission is declared', () => {
    const counts: ProviderCounts = { fileSystem: 0, universalHistory: 0 };
    const context = createContext(['history:read'], counts);

    assert.throws(
      () => context.getFileSystem(),
      (error: unknown) => {
        assert.ok(error instanceof PluginPermissionError);
        assert.equal(error.code, 'PLUGIN_PERMISSION');
        assert.equal(error.operation, 'getFileSystem');
        assert.deepEqual(error.requiredPermissions, ['fs:read', 'fs:write']);
        return true;
      },
    );
    assert.equal(counts.fileSystem, 0);
  });

  it('denies history access when no history permission is declared', () => {
    const counts: ProviderCounts = { fileSystem: 0, universalHistory: 0 };
    const context = createContext(['fs:write'], counts);

    assert.throws(
      () => context.getUniversalHistory(),
      (error: unknown) => {
        assert.ok(error instanceof PluginPermissionError);
        assert.equal(error.operation, 'getUniversalHistory');
        assert.deepEqual(error.requiredPermissions, ['history:read', 'history:write']);
        return true;
      },
    );
    assert.equal(counts.universalHistory, 0);
  });

  it('returns a memoized filesystem facade for read or write permissions', () => {
    const counts: ProviderCounts = { fileSystem: 0, universalHistory: 0 };
    const context = createContext(['fs:write'], counts);

    const first = context.getFileSystem();
    const second = context.getFileSystem();

    assert.ok(first instanceof UnusedFileSystem);
    assert.equal(first, second);
    assert.equal(counts.fileSystem, 1);
  });

  it('returns a memoized history facade for read or write permissions', () => {
    const counts: ProviderCounts = { fileSystem: 0, universalHistory: 0 };
    // Official since D-15 U-6: the core session history is official-only.
    const context = createContext(['history:read'], counts, true);

    const first = context.getUniversalHistory();
    const second = context.getUniversalHistory();

    assert.ok(first instanceof UnusedUniversalHistory);
    assert.equal(first, second);
    assert.equal(counts.universalHistory, 1);
  });

  it('denies the core session history to a non-official plugin even with history permissions', () => {
    const counts: ProviderCounts = { fileSystem: 0, universalHistory: 0 };
    const context = createContext(['history:read', 'history:write'], counts, false);

    assert.throws(
      () => context.getUniversalHistory(),
      (error: unknown) => {
        assert.ok(error instanceof PluginPermissionError);
        assert.equal(error.operation, 'getUniversalHistory');
        assert.match(error.message, /reserved for official plugins; use getHistory\(\)/u);
        return true;
      },
    );
    assert.equal(counts.universalHistory, 0);
  });

  it('denies the namespace history when no history permission is declared', () => {
    const counts: ProviderCounts = { fileSystem: 0, universalHistory: 0 };
    const context = createContext(['fs:write'], counts);

    assert.throws(
      () => context.getHistory(),
      (error: unknown) => {
        assert.ok(error instanceof PluginPermissionError);
        assert.equal(error.operation, 'getHistory');
        assert.deepEqual(error.requiredPermissions, ['history:read', 'history:write']);
        return true;
      },
    );
    assert.equal(counts.history, undefined);
  });

  it('returns a memoized namespace history handle to official and non-official plugins', () => {
    for (const official of [false, true]) {
      const counts: ProviderCounts = { fileSystem: 0, universalHistory: 0 };
      const context = createContext(['history:read'], counts, official);

      const first = context.getHistory();
      const second = context.getHistory();

      assert.equal(first.namespace, UNUSED_NAMESPACE_HANDLE.namespace);
      assert.ok(Object.isFrozen(first));
      assert.equal(first, second);
      assert.equal(counts.history, 1);
    }
  });

  it('disposes entry types registered through getHistory() with the plugin subscriptions', async () => {
    disposedEntryTypes = 0;
    const context = createContext(['history:write']);

    context.getHistory().registerEntryType({
      type: 'note',
      schemaVersion: 1,
      payloadSchema: true,
      reversal: { mode: 'none' },
    });
    assert.equal(disposedEntryTypes, 0);

    await context.subscriptions.disposeAll();

    assert.equal(disposedEntryTypes, 1);
  });
});
