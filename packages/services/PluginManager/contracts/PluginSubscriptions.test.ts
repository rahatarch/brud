import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PluginSubscriptions } from './PluginSubscriptions.js';
import type { IPluginDisposable } from './IPluginContext.js';

function recordingDisposable(order: string[], label: string, asynchronous = false): IPluginDisposable {
  return {
    dispose: async (): Promise<void> => {
      if (asynchronous) {
        await Promise.resolve();
      }
      order.push(label);
    },
  };
}

describe('PluginSubscriptions', () => {
  it('disposes resources in reverse registration order', async () => {
    const subscriptions = new PluginSubscriptions();
    const order: string[] = [];

    subscriptions.add(recordingDisposable(order, 'first'));
    subscriptions.add(recordingDisposable(order, 'second', true));
    subscriptions.add(recordingDisposable(order, 'third'));

    await subscriptions.disposeAll();

    assert.deepEqual(order, ['third', 'second', 'first']);
  });

  it('is idempotent', async () => {
    const subscriptions = new PluginSubscriptions();
    const order: string[] = [];

    subscriptions.add(recordingDisposable(order, 'only'));

    await subscriptions.disposeAll();
    await subscriptions.disposeAll();

    assert.deepEqual(order, ['only']);
  });

  it('attempts every disposable and rethrows the first observed failure', async () => {
    const subscriptions = new PluginSubscriptions();
    const order: string[] = [];
    const firstObserved = new Error('third disposal failed');

    subscriptions.add(recordingDisposable(order, 'first'));
    subscriptions.add({
      dispose: (): void => {
        order.push('second');
        throw new Error('second disposal failed');
      },
    });
    subscriptions.add({
      dispose: async (): Promise<void> => {
        order.push('third');
        throw firstObserved;
      },
    });

    await assert.rejects(subscriptions.disposeAll(), (error: unknown) => {
      assert.equal(error, firstObserved);
      return true;
    });

    assert.deepEqual(order, ['third', 'second', 'first']);
  });

  it('rejects registration after disposal', async () => {
    const subscriptions = new PluginSubscriptions();
    const order: string[] = [];

    await subscriptions.disposeAll();

    assert.throws(
      () => subscriptions.add(recordingDisposable(order, 'late')),
      /already disposed/,
    );
    assert.deepEqual(order, []);
  });

  it('disposes nothing when no resources were registered', async () => {
    const subscriptions = new PluginSubscriptions();

    await subscriptions.disposeAll();
  });
});
