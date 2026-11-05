/**
 * Goal 10 — Adversarial resilience.
 *
 * Concurrency, pathological globs, content injection, prototype pollution,
 * forged session identifiers, and extreme path shapes.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { IUniversalHistoryService } from '@brud/kernel';
import { createFile } from '../groups/file/createFile/index.js';
import {
  acquireVerificationLock,
  bootVerificationKernel,
  createRuntime,
  errorCode,
  invoke,
  readReal,
  readRealBytes,
  realExists,
  releaseVerificationLock,
  writeReal,
} from './support/harness.test.js';
import type { VerificationKernel } from './support/harness.test.js';

let kernel: VerificationKernel;

before(async () => {
  await acquireVerificationLock();
  kernel = await bootVerificationKernel({ prefix: 'brud-fs-verify-adversarial-' });
});

after(async () => {
  await kernel.shutdown();
  await releaseVerificationLock();
});

function countOccurrences(content: string, needle: string): number {
  return content.split(needle).length - 1;
}

function pathOfDepth(depth: number, leaf: string): string {
  return [
    ...Array.from({ length: depth - 1 }, (_, index) => `a${index + 1}`),
    leaf,
  ].join('/');
}

describe('Goal 10 — concurrent mutation serialization', () => {
  it('two concurrent append_file calls keep both appends', async () => {
    await writeReal(kernel.root, 'adv/append.txt', 'base');

    const [first, second] = await Promise.all([
      invoke(kernel, 'append_file', { path: 'adv/append.txt', content: 'FIRST' }),
      invoke(kernel, 'append_file', { path: 'adv/append.txt', content: 'SECOND' }),
    ]);

    assert.equal(first.status, 'success');
    assert.equal(second.status, 'success');

    const content = await readReal(kernel.root, 'adv/append.txt');

    assert.equal(countOccurrences(content, 'FIRST'), 1);
    assert.equal(countOccurrences(content, 'SECOND'), 1);
    assert.equal(countOccurrences(content, 'base'), 1);
  });

  it('twenty concurrent append_file calls serialize without loss', async () => {
    await writeReal(kernel.root, 'adv/append-many.txt', 'base');

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        invoke(kernel, 'append_file', {
          path: 'adv/append-many.txt',
          content: `TOKEN-${String(index).padStart(2, '0')}`,
        })),
    );

    assert.equal(results.every((result) => result.status === 'success'), true);

    const content = await readReal(kernel.root, 'adv/append-many.txt');

    for (let index = 0; index < 20; index += 1) {
      const token = `TOKEN-${String(index).padStart(2, '0')}`;
      assert.equal(countOccurrences(content, token), 1, `${token} must appear once`);
    }
  });

  it('two concurrent create_file calls produce one success and one CONFLICT', async () => {
    const results = await Promise.all([
      invoke(kernel, 'create_file', { path: 'adv/create-race.txt', content: 'one' }),
      invoke(kernel, 'create_file', { path: 'adv/create-race.txt', content: 'two' }),
    ]);
    const successes = results.filter((result) => result.status === 'success');
    const failures = results.filter((result) => result.status !== 'success');

    assert.equal(successes.length, 1);
    assert.equal(failures.length, 1);
    assert.equal(errorCode(failures[0]!), 'CONFLICT');
    assert.ok(['one', 'two'].includes(await readReal(kernel.root, 'adv/create-race.txt')));
  });

  it('concurrent append and search_replace on one file serialize deterministically', async () => {
    await writeReal(kernel.root, 'adv/mixed.txt', 'base');

    const [append, replace] = await Promise.all([
      invoke(kernel, 'append_file', { path: 'adv/mixed.txt', content: 'TAIL' }),
      invoke(kernel, 'search_replace', {
        path: 'adv/mixed.txt',
        search: 'base',
        replace: 'HEAD',
      }),
    ]);

    assert.equal(append.status, 'success');
    assert.equal(replace.status, 'success');
    assert.equal(await readReal(kernel.root, 'adv/mixed.txt'), 'HEAD\n\nTAIL');
  });

  it('concurrent delete_file calls do not corrupt the workspace', async () => {
    await writeReal(kernel.root, 'adv/delete-race.txt', 'x');

    const results = await Promise.all([
      invoke(kernel, 'delete_file', { path: 'adv/delete-race.txt' }),
      invoke(kernel, 'delete_file', { path: 'adv/delete-race.txt' }),
    ]);

    assert.equal(results.every((result) => result.status === 'success'), true);
    assert.equal(await realExists(kernel.root, 'adv/delete-race.txt'), false);
  });
});

describe('Goal 10 — pathological globs', () => {
  it('a deeply nested glob completes within five seconds', async () => {
    await writeReal(kernel.root, 'adv/glob/a.txt', 'a');
    await writeReal(kernel.root, 'adv/glob/nested/b.txt', 'b');

    const started = Date.now();
    const result = await invoke(kernel, 'append_file_multi', {
      pattern: '**/**/**/**/**/*',
      scope: 'adv/glob',
      content: 'X',
    });
    const elapsed = Date.now() - started;

    assert.ok(elapsed < 5_000, `glob took ${elapsed}ms`);
    assert.ok(['success', 'aborted', 'failed'].includes(result.status));
  });

  it('rejects a pattern with too many brace groups', async () => {
    const result = await invoke(kernel, 'append_file_multi', {
      pattern: '{a,b}'.repeat(40),
      content: 'X',
    });

    assert.equal(result.status, 'aborted');
    assert.equal(errorCode(result), 'VALIDATION_ERROR');
  });

  it('rejects an overlong pattern', async () => {
    const result = await invoke(kernel, 'append_file_multi', {
      pattern: 'a'.repeat(2_000),
      content: 'X',
    });

    assert.equal(result.status, 'aborted');
    assert.equal(errorCode(result), 'VALIDATION_ERROR');
  });
});

describe('Goal 10 — content injection and schema hardening', () => {
  const payloads = [
    '</script><script>alert(1)</script>',
    '$(rm -rf /)',
    '`touch /tmp/pwned`',
    "' OR 1=1 --",
    '${process.exit(1)}',
    '{{7*7}}',
    '../'.repeat(20),
  ];

  for (const payload of payloads) {
    it(`writes ${JSON.stringify(payload)} literally`, async () => {
      const path = `adv/injection/${Buffer.from(payload).toString('hex').slice(0, 16)}.txt`;
      const result = await invoke(kernel, 'create_file', { path, content: payload });

      assert.equal(result.status, 'success');
      assert.equal(await readReal(kernel.root, path), payload);
    });
  }

  it('rejects an extra index property through schema validation', async () => {
    const result = await invoke(kernel, 'create_file', {
      path: 'adv/index.txt',
      content: 'x',
      index: '1',
    });

    assert.equal(result.status, 'failed');
    assert.match(String(result.error), /TOOL_VALIDATION_ERROR/u);
    assert.equal(await realExists(kernel.root, 'adv/index.txt'), false);
  });

  it('rejects a prototype-pollution payload without polluting Object.prototype', async () => {
    const payload = JSON.parse(
      '{"__proto__":{"polluted":true},"path":"adv/proto.txt","content":"x"}',
    ) as Record<string, unknown>;
    const result = await invoke(kernel, 'create_file', payload);

    assert.equal(result.status, 'failed');
    assert.match(String(result.error), /TOOL_VALIDATION_ERROR/u);
    assert.equal(
      ({} as Record<string, unknown>)['polluted'],
      undefined,
      'Object.prototype must remain clean',
    );
  });

  it('writes NUL bytes in content literally', async () => {
    const content = 'before\0after';
    const result = await invoke(kernel, 'create_file', {
      path: 'adv/nul-content.txt',
      content,
    });

    assert.equal(result.status, 'success');
    const bytes = await readRealBytes(kernel.root, 'adv/nul-content.txt');

    assert.deepEqual([...bytes], [...Buffer.from(content, 'utf8')]);
  });
});

describe('Goal 10 — forged session identifiers', () => {
  it('rejects a non-existent session id at commit without corrupting real sessions', async () => {
    const real = await invoke(kernel, 'create_file', {
      path: 'adv/session-real.txt',
      content: 'real',
    });
    const realSessionId = (real.data as { sessionId?: string }).sessionId!;

    await assert.rejects(
      () => kernel.history.commitSession('BR-19990101-999', 'completed'),
    );

    const realSession = await kernel.history.getSession(realSessionId);

    assert.ok(realSession);
    assert.equal(realSession.status, 'committed');
  });

  it('rejects a malformed session id before applying the mutation', async () => {
    const history: IUniversalHistoryService = {
      beginSession: async (): Promise<string> => 'BR-19990101-99',
      commitSession: async (): Promise<never> => {
        throw new Error('must not commit');
      },
      planReversal: kernel.history.planReversal.bind(kernel.history),
      executeReversal: kernel.history.executeReversal.bind(kernel.history),
      getSession: kernel.history.getSession.bind(kernel.history),
      listSessions: kernel.history.listSessions.bind(kernel.history),
    };
    const runtime = {
      ...createRuntime(kernel),
      getUniversalHistory: () => history,
    };

    const result = await createFile(
      { path: 'adv/forged-malformed.txt', content: 'x' },
      runtime,
    );

    assert.equal(result.status, 'failed');
    assert.equal(errorCode(result), 'HISTORY_FAILED');
    assert.equal(await realExists(kernel.root, 'adv/forged-malformed.txt'), false);
  });

  it('rejects a well-formed but non-existent session id before mutating', async () => {
    const history: IUniversalHistoryService = {
      beginSession: async (): Promise<string> => 'BR-19990101-999',
      commitSession: (sessionId, outcome) =>
        kernel.history.commitSession(sessionId, outcome),
      planReversal: kernel.history.planReversal.bind(kernel.history),
      executeReversal: kernel.history.executeReversal.bind(kernel.history),
      getSession: kernel.history.getSession.bind(kernel.history),
      listSessions: kernel.history.listSessions.bind(kernel.history),
    };
    const runtime = {
      ...createRuntime(kernel),
      getUniversalHistory: () => history,
    };

    const result = await createFile(
      { path: 'adv/forged-well-formed-documented.txt', content: 'written-before-rejection' },
      runtime,
    );

    assert.equal(result.status, 'failed');
    assert.equal(errorCode(result), 'HISTORY_FAILED');
    assert.equal(
      await realExists(kernel.root, 'adv/forged-well-formed-documented.txt'),
      false,
      'a well-formed but unregistered session id must be rejected before the mutation runs',
    );
  });

  it('rejects a well-formed forged session id before mutating', async () => {
    const history: IUniversalHistoryService = {
      beginSession: async (): Promise<string> => 'BR-19990101-998',
      commitSession: (sessionId, outcome) =>
        kernel.history.commitSession(sessionId, outcome),
      planReversal: kernel.history.planReversal.bind(kernel.history),
      executeReversal: kernel.history.executeReversal.bind(kernel.history),
      getSession: kernel.history.getSession.bind(kernel.history),
      listSessions: kernel.history.listSessions.bind(kernel.history),
    };
    const runtime = {
      ...createRuntime(kernel),
      getUniversalHistory: () => history,
    };

    const result = await createFile(
      { path: 'adv/forged-well-formed-strict.txt', content: 'must-not-be-written' },
      runtime,
    );

    assert.equal(result.status, 'failed');
    assert.equal(errorCode(result), 'HISTORY_FAILED');
    assert.equal(
      await realExists(kernel.root, 'adv/forged-well-formed-strict.txt'),
      false,
      'a forged session id must be rejected before the mutation runs',
    );
  });
});

describe('Goal 10 — extreme path shapes', () => {
  it('rejects a 5,000-character path without crashing', async () => {
    const path = `${'a'.repeat(5_000)}.txt`;
    const result = await invoke(kernel, 'create_file', { path, content: 'x' });

    assert.notEqual(result.status, 'success');
    assert.ok(errorCode(result));
  });

  it('rejects a 50-level nested path with a depth violation', async () => {
    const path = pathOfDepth(50, 'file.txt');
    const result = await invoke(kernel, 'create_file', { path, content: 'x' });

    assert.equal(result.status, 'aborted');
    assert.equal(errorCode(result), 'VALIDATION_ERROR');
    assert.equal(await realExists(kernel.root, path), false);
  });

  it('rejects a NUL byte path without crashing', async () => {
    const result = await invoke(kernel, 'create_file', {
      path: 'adv/nul\0path.txt',
      content: 'x',
    });

    assert.equal(result.status, 'aborted');
    assert.equal(errorCode(result), 'WORKSPACE_PATH_VIOLATION');
  });
});