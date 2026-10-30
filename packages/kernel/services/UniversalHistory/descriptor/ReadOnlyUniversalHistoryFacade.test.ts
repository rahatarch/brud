import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { IUniversalHistoryService } from '../contracts/IUniversalHistoryService/IUniversalHistoryService.js';
import type { ReversalPlan } from '../operations/plan_reversal/types.js';
import {
  ReadOnlyUniversalHistoryFacade,
  UniversalHistoryReadOnlyViolationError,
} from './ReadOnlyUniversalHistoryFacade.js';

const SESSION = { id: 'BR-20261030-001' } as never;
const ROWS = [{ id: 'BR-20261030-001' }] as never;
const PLAN = { sessionId: 'BR-20261030-001', executable: true } as never;

class RecordingHistory implements IUniversalHistoryService {
  public readonly calls: string[] = [];

  beginSession(prompt: string, targets?: readonly string[]): Promise<string> {
    this.calls.push(`beginSession:${prompt}:${String(targets?.length)}`);
    return Promise.resolve('BR-raw');
  }

  commitSession(sessionId: string, outcome: string): Promise<never> {
    this.calls.push(`commitSession:${sessionId}:${outcome}`);
    return Promise.resolve({} as never);
  }

  planReversal(sessionId: string, options?: unknown): Promise<ReversalPlan> {
    this.calls.push(`planReversal:${sessionId}:${JSON.stringify(options)}`);
    return Promise.resolve(PLAN);
  }

  executeReversal(_plan: ReversalPlan): Promise<never> {
    this.calls.push('executeReversal');
    return Promise.resolve({} as never);
  }

  getSession(sessionId: string): Promise<never> {
    this.calls.push(`getSession:${sessionId}`);
    return Promise.resolve(SESSION);
  }

  listSessions(filter?: unknown): Promise<never> {
    this.calls.push(`listSessions:${JSON.stringify(filter)}`);
    return Promise.resolve(ROWS);
  }
}

function isReadOnlyViolation(operation: string): (error: unknown) => boolean {
  return (error: unknown) => {
    assert.ok(error instanceof UniversalHistoryReadOnlyViolationError);
    assert.equal(error.code, 'READ_ONLY_VIOLATION');
    assert.equal(error.operation, operation);
    assert.match(error.message, new RegExp(`"${operation}"`, 'u'));
    return true;
  };
}

describe('ReadOnlyUniversalHistoryFacade', () => {
  it('delegates getSession, listSessions, and planReversal unchanged', async () => {
    const inner = new RecordingHistory();
    const facade = new ReadOnlyUniversalHistoryFacade(inner);

    assert.equal(await facade.getSession('BR-20261030-001'), SESSION);
    assert.equal(await facade.listSessions({ limit: 5 } as never), ROWS);
    assert.equal(await facade.planReversal('BR-20261030-001', { target: 'pre' } as never), PLAN);
    assert.deepEqual(inner.calls, [
      'getSession:BR-20261030-001',
      'listSessions:{"limit":5}',
      'planReversal:BR-20261030-001:{"target":"pre"}',
    ]);
  });

  it('rejects beginSession, commitSession, and executeReversal without reaching the service', async () => {
    const inner = new RecordingHistory();
    const facade = new ReadOnlyUniversalHistoryFacade(inner);

    await assert.rejects(() => facade.beginSession('prompt', ['a.txt']), isReadOnlyViolation('beginSession'));
    await assert.rejects(() => facade.commitSession('BR-1', 'completed'), isReadOnlyViolation('commitSession'));
    await assert.rejects(() => facade.executeReversal(PLAN), isReadOnlyViolation('executeReversal'));
    assert.deepEqual(inner.calls, []);
  });

  it('exposes no path to the delegate, even by casting, and is frozen', () => {
    const inner = new RecordingHistory();
    const facade = new ReadOnlyUniversalHistoryFacade(inner);
    const loose = facade as unknown as Record<string | symbol, unknown>;

    for (const key of Reflect.ownKeys(facade)) {
      assert.notEqual(loose[key], inner, `own key ${String(key)} must not hold the delegate`);
    }
    assert.deepEqual(Reflect.ownKeys(facade), []);
    assert.equal(loose.inner, undefined);
    assert.equal(loose.service, undefined);
    assert.equal(loose.delegate, undefined);
    assert.equal(Object.isFrozen(facade), true);
    assert.throws(() => {
      'use strict';
      loose.beginSession = (): Promise<string> => inner.beginSession('bypass');
    }, TypeError);
    assert.deepEqual(inner.calls, []);
  });
});
