import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { IBrudFileSystem } from '../../BrudFileSystem/contracts/index.js';
import type { IPluginHistoryService } from '../../UniversalHistory/contracts/index.js';
import type { NamespaceHistoryHandle } from '../../UniversalHistory/unified/service/types.js';
import type { IUtilityService } from '../../UtilityService/contracts/IUtilityService.js';
import { PluginPermissionError } from './errors.js';
import type { IPluginLogger, IPluginSubscriptions } from './IPluginContext.js';
import { PluginContext } from './PluginContext.js';
import type { PluginPermission } from './permissions.js';
import { PluginSubscriptions } from './PluginSubscriptions.js';
import { createServiceToken } from '@brud/kernel';
import { createTestPluginContext } from '../../../kernel/src/__tests__/support/testApiRegistry.js';
import { CORE_API_NAME, lastProjectionWins } from '../../ExposedApiRegistry/contracts/index.js';
import { FileSystemToken } from '../../BrudFileSystem/descriptor/tokens.js';
import { UniversalHistoryToken } from '../../UniversalHistory/descriptor/tokens.js';
import { UtilityToken } from '../../UtilityService/descriptor/tokens.js';

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

  async rename(): Promise<never> {
    throw new Error('filesystem facade is not used in this test');
  }

  async copy(): Promise<never> {
    throw new Error('filesystem facade is not used in this test');
  }

  async createDirectory(): Promise<never> {
    throw new Error('filesystem facade is not used in this test');
  }

  async deleteDirectory(): Promise<never> {
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

class UnusedUniversalHistory implements IPluginHistoryService {
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

  getSessionView(): never {
    throw new Error('history facade is not used in this test');
  }

  listDeleteHistory(): never {
    throw new Error('history facade is not used in this test');
  }

  async planOperationReversal(): Promise<never> {
    throw new Error('history facade is not used in this test');
  }

  trashSession(): never {
    throw new Error('history facade is not used in this test');
  }

  restoreSession(): never {
    throw new Error('history facade is not used in this test');
  }

  deleteSessionPermanently(): never {
    throw new Error('history facade is not used in this test');
  }

  async wipeAllSessions(): Promise<never> {
    throw new Error('history facade is not used in this test');
  }

  async revertOperations(): Promise<never> {
    throw new Error('history facade is not used in this test');
  }

  deleteAuditLog(): never {
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
  utilities?: number;
}

const UNUSED_UTILITIES: IUtilityService = Object.freeze({
  resolveImports: async (): Promise<string[]> => [],
});

let disposedEntryTypes = 0;
const UNUSED_NAMESPACE_HANDLE = Object.freeze({
  namespace: 'brud.tools.core',
  registerEntryType: () => ({ dispose: (): void => void (disposedEntryTypes += 1) }),
}) as unknown as NamespaceHistoryHandle;

const NS_HISTORY_TOKEN = createServiceToken<UnusedUniversalHistory>(
  'test.namespaceHistory',
  'Test-only namespace history token',
);

function createContext(
  permissions: readonly PluginPermission[],
  counts: ProviderCounts = { fileSystem: 0, universalHistory: 0 },
  official = false,
): PluginContext {
  const { context } = createTestPluginContext({
    pluginId: 'brud.tools.core',
    workspaceRoot: '/workspace',
    permissions,
    official,
    services: {
      fileSystem: new UnusedFileSystem(),
      utilities: UNUSED_UTILITIES,
    },
    extraServices: new Map([
      [UniversalHistoryToken.id, new UnusedUniversalHistory()],
      [NS_HISTORY_TOKEN.id, new UnusedUniversalHistory()],
    ]),
    seed: (registry) => {
      registry.registerApi(CORE_API_NAME.universalHistory, UniversalHistoryToken, {
        capability: 'history:read',
        scope: 'runtime',
        combine: lastProjectionWins,
      });
      registry.registerApi(CORE_API_NAME.universalHistory, UniversalHistoryToken, {
        capability: 'history:write',
        scope: 'runtime',
        combine: lastProjectionWins,
      });
      registry.registerApi(CORE_API_NAME.namespaceHistory, NS_HISTORY_TOKEN, {
        capability: 'history:read',
        scope: 'runtime',
        projection: () => UNUSED_NAMESPACE_HANDLE,
        combine: lastProjectionWins,
      });
      registry.registerApi(CORE_API_NAME.namespaceHistory, NS_HISTORY_TOKEN, {
        capability: 'history:write',
        scope: 'runtime',
        projection: () => UNUSED_NAMESPACE_HANDLE,
        combine: lastProjectionWins,
      });
    },
    onAccess: (tokenId) => {
      if (tokenId === FileSystemToken.id) {
        counts.fileSystem += 1;
      } else if (tokenId === UniversalHistoryToken.id) {
        counts.universalHistory += 1;
      } else if (tokenId === NS_HISTORY_TOKEN.id) {
        counts.history = (counts.history ?? 0) + 1;
      } else if (tokenId === UtilityToken.id) {
        counts.utilities = (counts.utilities ?? 0) + 1;
      }
    },
  });

  return context;
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
    const { context } = createTestPluginContext({
      pluginId: 'brud.tools.core',
      workspaceRoot: '/workspace',
      permissions: [],
      logger,
      subscriptions,
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
    // Official since D-15 U-6: the core session history is official-only.
    for (const permission of ['history:read', 'history:write'] as const) {
      const counts: ProviderCounts = { fileSystem: 0, universalHistory: 0 };
      const context = createContext([permission], counts, true);

      const first = context.getUniversalHistory();
      const second = context.getUniversalHistory();

      assert.equal(first, second);
      assert.equal(counts.universalHistory, 1);
    }
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
    assert.equal(counts.history ?? 0, 0);
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

  it('returns a memoized utility service without requiring a permission', () => {
    const counts: ProviderCounts = { fileSystem: 0, universalHistory: 0 };
    const context = createContext([], counts);

    const first = context.getUtilities();
    const second = context.getUtilities();

    assert.equal(first, UNUSED_UTILITIES);
    assert.equal(first, second);
    assert.equal(counts.utilities, 1);
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
