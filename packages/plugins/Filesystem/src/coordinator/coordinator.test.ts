import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionManifest } from '@brud/kernel';
import type { FileStats } from '@brud/service-filesystem';
import type { IBrudFileSystem } from '@brud/service-filesystem';
import type { IUniversalHistoryService } from '@brud/service-history';
import { KeyedMutex, executeMutation } from './index.js';
import type { MutationContext } from './index.js';
import { FilesystemError } from '../errors/index.js';

class FakeFileSystem {
  public readonly files = new Map<string, string>();

  public readonly writes: string[] = [];

  public async stat(path: string): Promise<FileStats | null> {
    if (!this.files.has(path)) {
      return null;
    }

    return {
      size: Buffer.byteLength(this.files.get(path)!, 'utf8'),
      mtimeMs: 0,
      isFile: true,
      isDirectory: false,
    };
  }

  public async readFile(path: string): Promise<Uint8Array> {
    if (!this.files.has(path)) {
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
    }

    return new TextEncoder().encode(this.files.get(path)!);
  }

  public async writeAtomic(path: string, data: Uint8Array | string): Promise<void> {
    this.writes.push(path);
    this.files.set(path, typeof data === 'string' ? data : Buffer.from(data).toString('utf8'));
  }
}

class FakeHistory {
  public readonly calls: string[] = [];

  public readonly outcomes: string[] = [];

  public readonly commits: string[] = [];

  public lastPrompt: string | undefined;

  public lastTargets: readonly string[] | undefined;

  public sessionId = 'BR-20260101-001';

  public async beginSession(
    prompt: string,
    targets?: readonly string[],
  ): Promise<string> {
    this.calls.push('begin');
    this.lastPrompt = prompt;
    this.lastTargets = targets;

    return this.sessionId;
  }

  public async commitSession(sessionId: string, outcome: 'completed' | 'aborted'): Promise<void> {
    this.calls.push(`commit:${outcome}`);
    this.commits.push(sessionId);
    this.outcomes.push(outcome);
  }

  public async getSession(sessionId: string): Promise<SessionManifest | null> {
    if (sessionId !== this.sessionId) {
      return null;
    }

    return {
      schemaVersion: 1,
      sessionId,
      createdAt: '1970-01-01T00:00:00.000Z',
      prompt: 'test session',
      status: 'active',
      filesAffected: [],
      preDigests: {},
      postDigests: {},
    };
  }
}

function contextFor(fs: FakeFileSystem, history: FakeHistory): MutationContext {
  return {
    getFileSystem: () => fs as unknown as IBrudFileSystem,
    getUniversalHistory: () => history as unknown as IUniversalHistoryService,
    mutex: new KeyedMutex(),
  };
}

describe('mutation coordinator', () => {
  it('opens the history session before the mutation', async () => {
    const fs = new FakeFileSystem();
    const history = new FakeHistory();
    const order: string[] = [];

    const originalBegin = history.beginSession.bind(history);
    history.beginSession = async (prompt: string, targets?: readonly string[]) => {
      order.push('begin');

      return originalBegin(prompt, targets);
    };

    await executeMutation(contextFor(fs, history), {
      kind: 'create_file',
      targets: ['a.txt'],
      apply: async () => {
        order.push('apply');

        return { files: [{ path: 'a.txt', status: 'created' }] };
      },
    });

    assert.deepEqual(order, ['begin', 'apply']);
    assert.equal(history.lastPrompt, 'filesystem: create_file');
    assert.deepEqual(history.lastTargets, ['a.txt']);
  });

  it('commits completed on success', async () => {
    const fs = new FakeFileSystem();
    const history = new FakeHistory();

    const result = await executeMutation(contextFor(fs, history), {
      kind: 'create_file',
      targets: ['a.txt'],
      apply: async () => {
        await (fs as unknown as IBrudFileSystem).writeAtomic('a.txt', 'hello');

        return { files: [{ path: 'a.txt', status: 'created' }] };
      },
    });

    assert.equal(result.status, 'success');
    assert.deepEqual(history.outcomes, ['completed']);
    assert.equal(history.commits[0], 'BR-20260101-001');
  });

  it('commits aborted when the mutation throws', async () => {
    const fs = new FakeFileSystem();
    const history = new FakeHistory();

    const result = await executeMutation(contextFor(fs, history), {
      kind: 'create_file',
      targets: ['a.txt'],
      apply: async () => {
        throw new FilesystemError('CONFLICT', 'a.txt', 'File already exists.');
      },
    });

    assert.equal(result.status, 'aborted');
    assert.deepEqual(history.outcomes, ['aborted']);
    assert.equal(
      (result.data as { errors: Array<{ code: string }> }).errors[0]?.code,
      'CONFLICT',
    );
  });

  it('captures pre-state for existing and missing targets', async () => {
    const fs = new FakeFileSystem();
    fs.files.set('existing.txt', 'old content');
    const history = new FakeHistory();

    const result = await executeMutation(contextFor(fs, history), {
      kind: 'append_file',
      targets: ['existing.txt', 'missing.txt'],
      apply: async () => ({
        files: [{ path: 'existing.txt', status: 'appended' }],
      }),
    });

    const data = result.data as {
      preState: Array<{ path: string; status: string; content?: string }>;
    };

    assert.deepEqual(data.preState, [
      { path: 'existing.txt', status: 'file', content: 'old content', size: 11 },
      { path: 'missing.txt', status: 'missing' },
    ]);
  });

  it('serializes transactions that share a target', async () => {
    const fs = new FakeFileSystem();
    const history = new FakeHistory();
    const context = contextFor(fs, history);
    let active = 0;
    let peak = 0;

    const run = (): Promise<void> => executeMutation(context, {
      kind: 'append_file',
      targets: ['a.txt'],
      apply: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        active -= 1;

        return { files: [{ path: 'a.txt', status: 'appended' }] };
      },
    }).then(() => undefined);

    await Promise.all([run(), run()]);

    assert.equal(peak, 1, 'only one transaction may hold a target at a time');
  });

  it('rejects malformed history session identifiers', async () => {
    const fs = new FakeFileSystem();
    const history = new FakeHistory();
    history.sessionId = 'not-a-session';
    let applied = false;

    const result = await executeMutation(contextFor(fs, history), {
      kind: 'create_file',
      targets: ['a.txt'],
      apply: async () => {
        applied = true;

        return {};
      },
    });

    assert.equal(applied, false);
    assert.equal(
      (result.data as { errors: Array<{ code: string }> }).errors[0]?.code,
      'HISTORY_FAILED',
    );
  });
});