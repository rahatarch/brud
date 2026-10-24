import { Buffer } from 'node:buffer';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FileOperation } from '@brud/core';
import type {
  FileEncoding,
  FsListEntry,
  FsWriteAtomicResult,
  HistoryCommitOutcome,
  HistoryCommitSessionResult,
  HistoryReversalTargetState,
  HistoryRevertResult,
} from '@brud/protocol';
import type { DaemonExecutionClient } from '../daemon/daemonClientTypes';
import { DaemonFileSystem, DaemonUnsupportedFileSystemOperationError } from '../daemon/daemonFileSystem';
import { DaemonExecutionHandler } from '../daemon/daemonExecutionHandler';

const WORKSPACE_ROOT = join(tmpdir(), 'brud-adapter-daemon-workspace');
const SESSION_ID = 'BR-20260101-001';

interface BeginCall {
  readonly prompt: string;
  readonly targets: readonly string[];
}

interface CommitCall {
  readonly sessionId: string;
  readonly outcome: HistoryCommitOutcome;
}

interface RevertCall {
  readonly sessionId: string;
  readonly targetState: HistoryReversalTargetState | undefined;
}

class FakeDaemonClient implements DaemonExecutionClient {
  readonly files = new Map<string, string>();

  readonly beginCalls: BeginCall[] = [];

  readonly commitCalls: CommitCall[] = [];

  readonly revertCalls: RevertCall[] = [];

  revertResult: HistoryRevertResult = {
    sessionId: SESSION_ID,
    targetState: 'pre',
    isExecutable: true,
    actions: [],
    conflicts: [],
    receipt: {
      reversalId: 'REV-1',
      sessionId: SESSION_ID,
      targetState: 'pre',
      executedAt: '2026-01-01T00:00:00.000Z',
      filesRestored: 0,
      filesDeleted: 0,
    },
  };

  async fsReadFile(path: string, encoding: FileEncoding = 'utf8'): Promise<string> {
    const content = this.files.get(path);

    if (content === undefined) {
      throw new Error(`Missing file "${path}"`);
    }

    return encoding === 'base64'
      ? Buffer.from(content, 'utf8').toString('base64')
      : content;
  }

  async fsWriteAtomic(
    path: string,
    data: Uint8Array | string,
    encoding: FileEncoding = 'utf8',
  ): Promise<FsWriteAtomicResult> {
    const content = typeof data === 'string'
      ? data
      : Buffer.from(data).toString(encoding === 'base64' ? 'base64' : 'utf8');

    this.files.set(path, content);

    return { path, bytesWritten: Buffer.byteLength(content, 'utf8') };
  }

  async fsExists(path: string): Promise<boolean> {
    return this.files.has(path) || this.isDirectory(path);
  }

  async fsList(path: string): Promise<readonly FsListEntry[]> {
    const prefix = path === '.' || path.length === 0
      ? ''
      : `${path.replace(/\/+$/u, '')}/`;
    const entries = new Map<string, FsListEntry>();

    for (const filePath of this.files.keys()) {
      if (!filePath.startsWith(prefix)) {
        continue;
      }

      const remainder = filePath.slice(prefix.length);

      if (remainder.length === 0) {
        continue;
      }

      const segments = remainder.split('/');
      const name = segments[0];
      const isDirectory = segments.length > 1;

      if (name !== undefined) {
        entries.set(name, { name, isFile: !isDirectory, isDirectory });
      }
    }

    return [...entries.values()];
  }

  async fsStat(path: string): Promise<{
    size: number;
    mtimeMs: number;
    isFile: boolean;
    isDirectory: boolean;
  } | null> {
    const content = this.files.get(path);

    if (content !== undefined) {
      return {
        size: Buffer.byteLength(content, 'utf8'),
        mtimeMs: 0,
        isFile: true,
        isDirectory: false,
      };
    }

    if (this.isDirectory(path)) {
      return { size: 0, mtimeMs: 0, isFile: false, isDirectory: true };
    }

    return null;
  }

  async historyBeginSession(prompt: string, targets: readonly string[] = []): Promise<string> {
    this.beginCalls.push({ prompt, targets });
    return SESSION_ID;
  }

  async historyCommitSession(
    sessionId: string,
    outcome: HistoryCommitOutcome = 'completed',
  ): Promise<HistoryCommitSessionResult> {
    this.commitCalls.push({ sessionId, outcome });
    return {
      sessionId,
      committedFileCount: 1,
      committedAt: '2026-01-01T00:00:00.000Z',
      blobs: [],
    };
  }

  async historyRevert(
    sessionId: string,
    targetState?: HistoryReversalTargetState,
  ): Promise<HistoryRevertResult> {
    this.revertCalls.push({ sessionId, targetState });
    return this.revertResult;
  }

  private isDirectory(path: string): boolean {
    const prefix = `${path.replace(/\/+$/u, '')}/`;
    return [...this.files.keys()].some((filePath) => filePath.startsWith(prefix));
  }
}

function createHandler(client: FakeDaemonClient): DaemonExecutionHandler {
  return new DaemonExecutionHandler(client, { workspaceRoot: WORKSPACE_ROOT });
}

describe('DaemonExecutionHandler', () => {
  it('delegates patching through daemon filesystem helpers and commits a history session', async () => {
    const client = new FakeDaemonClient();
    client.files.set('src/app.ts', 'const value = 1;\n');
    const handler = createHandler(client);

    const operations: FileOperation[] = [{
      kind: 'search_replace',
      path: 'src/app.ts',
      index: '1',
      search: 'const value = 1;',
      replace: 'const value = 2;',
    }];

    const result = await handler.execute(operations, { originalPrompt: 'Update value' });

    assert.equal(result.success, true);
    assert.equal(result.sessionId, SESSION_ID);
    assert.equal(client.files.get('src/app.ts'), 'const value = 2;\n');
    assert.deepEqual(client.beginCalls, [{
      prompt: 'Update value',
      targets: ['src/app.ts'],
    }]);
    assert.deepEqual(client.commitCalls, [{
      sessionId: SESSION_ID,
      outcome: 'completed',
    }]);
    assert.equal(result.operationResults.length, 1);
    assert.equal(result.operationResults[0]?.kind, 'search_replace');
    assert.equal(result.operationResults[0]?.status, 'success');
    assert.equal(result.operationResults[0]?.message, 'Patched src/app.ts.');
  });

  it('creates files through the daemon without opening a history session for read-only work', async () => {
    const client = new FakeDaemonClient();
    const handler = createHandler(client);

    const createResult = await handler.execute([{
      kind: 'create_file',
      path: 'notes/todo.md',
      index: '1',
      content: 'first task\n',
    }], { originalPrompt: 'Create notes' });

    assert.equal(createResult.success, true);
    assert.equal(client.files.get('notes/todo.md'), 'first task\n');
    assert.equal(client.beginCalls.length, 1);

    const readResult = await handler.execute([{
      kind: 'read_file',
      path: 'notes/todo.md',
      isImportRead: false,
      maxDepth: 0,
      index: '2',
    }], { originalPrompt: 'Read notes' });

    assert.equal(readResult.success, true);
    assert.equal(readResult.sessionId, undefined);
    assert.equal(client.beginCalls.length, 1);
  });

  it('maps revert lifecycle calls into backwards-compatible FileOperationResult data', async () => {
    const client = new FakeDaemonClient();
    client.revertResult = {
      ...client.revertResult,
      actions: [{
        relativePath: 'src/app.ts',
        action: 'restore',
        expectedCurrentSha256: 'abc',
        actualCurrentSha256: 'abc',
      }],
    };
    const handler = createHandler(client);

    const result = await handler.revert(SESSION_ID, 'pre');

    assert.equal(result.success, true);
    assert.equal(result.sessionId, SESSION_ID);
    assert.equal(result.errors.length, 0);
    assert.equal(result.operationResults.length, 1);
    assert.equal(result.operationResults[0]?.kind, 'history_revert');
    assert.equal(result.operationResults[0]?.status, 'success');
    assert.deepEqual(client.revertCalls, [{ sessionId: SESSION_ID, targetState: 'pre' }]);
  });

  it('returns a formatted failure when the history session cannot begin', async () => {
    const client = new FakeDaemonClient();
    client.historyBeginSession = async () => {
      throw new Error('ledger unavailable');
    };
    const handler = createHandler(client);

    const result = await handler.execute([{
      kind: 'create_file',
      path: 'notes/todo.md',
      index: '1',
      content: 'first task\n',
    }]);

    assert.equal(result.success, false);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]?.code, 'UNEXPECTED_ERROR');
    assert.equal(client.files.size, 0);
  });

  it('returns a formatted failure when the daemon rejects a revert request', async () => {
    const client = new FakeDaemonClient();
    client.historyRevert = async () => {
      throw new Error('daemon unavailable');
    };
    const handler = createHandler(client);

    const result = await handler.revert(SESSION_ID);

    assert.equal(result.success, false);
    assert.equal(result.sessionId, SESSION_ID);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]?.code, 'UNEXPECTED_ERROR');
  });

  it('reports non-executable reversal plans as BrudError conflicts', async () => {
    const client = new FakeDaemonClient();
    client.revertResult = {
      sessionId: SESSION_ID,
      targetState: 'pre',
      isExecutable: false,
      actions: [],
      conflicts: [{
        relativePath: 'src/app.ts',
        code: 'STALE_BASELINE_CONFLICT',
        message: 'The current digest does not match the expected digest.',
        expectedSha256: 'abc',
        actualSha256: 'def',
      }],
      receipt: null,
    };
    const handler = createHandler(client);

    const result = await handler.revert(SESSION_ID);

    assert.equal(result.success, false);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]?.code, 'REVERT_CONFLICT');
    assert.equal(result.errors[0]?.path, 'src/app.ts');
  });
});

describe('DaemonFileSystem', () => {
  it('maps absolute paths to workspace-relative daemon paths', async () => {
    const client = new FakeDaemonClient();
    client.files.set('src/app.ts', 'content\n');
    const fileSystem = new DaemonFileSystem(client, { workspaceRoot: WORKSPACE_ROOT });

    assert.equal(await fileSystem.readFile(join(WORKSPACE_ROOT, 'src', 'app.ts')), 'content\n');
    assert.equal(await fileSystem.exists('src/app.ts'), true);
    assert.deepEqual(await fileSystem.listDirectory('src'), ['app.ts']);
    assert.deepEqual(await fileSystem.stat('src/app.ts'), { size: 8, isDirectory: false });
  });

  it('refuses unsupported mutations when no fallback filesystem is supplied', async () => {
    const client = new FakeDaemonClient();
    const fileSystem = new DaemonFileSystem(client, { workspaceRoot: WORKSPACE_ROOT });

    await assert.rejects(
      () => fileSystem.deleteFile('src/app.ts'),
      DaemonUnsupportedFileSystemOperationError,
    );
  });
});
