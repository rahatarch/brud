import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { bootTestKernel } from '@brud/sdk/testing';
import { createService } from '../src/participant.js';
import type { DbExposure, SecretsExposure } from '../src/contracts/types.js';

const DB_PARTICIPANT_PATH = resolve(fileURLToPath(new URL('../src/participant.ts', import.meta.url)));

const reports = (): Record<string, Record<string, unknown>> =>
  ((globalThis as { __dbTest?: Record<string, Record<string, unknown>> }).__dbTest ??= {});

describe('@brud/db Participant Descriptor & Kernel Integration', () => {
  it('conforms to the kernel participant descriptor contract without kinds', () => {
    const descriptor = createService();

    assert.equal(descriptor.token.id, 'brud.db');
    assert.equal(descriptor.tier, 'userland');
    assert.ok(descriptor.manifest);

    // Exposures: strictly brud.db and brud.secrets
    const exposureNames = descriptor.manifest.exposures.map((e) => e.name).sort();
    assert.deepEqual(exposureNames, [
      'brud.db',
      'brud.secrets',
    ]);

    // Kinds: none declared
    assert.equal(descriptor.manifest.kinds, undefined);
  });

  it('exposures enforce strict tenant isolation across programmatic handles', async () => {
    const descriptor = createService();
    const serviceContext = {
      caller: { callerId: 'system', tier: 'userland' as const, options: {} },
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    };
    const instance = descriptor.factory(serviceContext as never);
    const mockBroker = {
      requestAccess: () => null,
    };
    await (instance as { onRunning?: (broker: unknown) => Promise<void> }).onRunning?.(mockBroker);

    const provideExposure = (instance as {
      provideExposure?: (name: string, major: number) => { projection: (inst: unknown, caller: unknown) => unknown } | null;
    }).provideExposure;

    assert.ok(provideExposure);

    // Check brud.db handle for Caller 1 vs Caller 2
    const dbBinding = provideExposure('brud.db', 1);
    assert.ok(dbBinding);
    const db1 = dbBinding.projection(instance, { callerId: 'agent-1' }) as DbExposure;
    const db2 = dbBinding.projection(instance, { callerId: 'agent-2' }) as DbExposure;

    await db1.set('shared-key', { agent: 1 });
    await db2.set('shared-key', { agent: 2 });

    assert.deepEqual(await db1.get('shared-key'), { agent: 1 });
    assert.deepEqual(await db2.get('shared-key'), { agent: 2 });

    const list1 = await db1.list();
    const list2 = await db2.list();
    assert.deepEqual(list1, ['shared-key']);
    assert.deepEqual(list2, ['shared-key']);

    // Check brud.secrets handle for Caller 1 vs Caller 2
    const secretsBinding = provideExposure('brud.secrets', 1);
    assert.ok(secretsBinding);
    const sec1 = secretsBinding.projection(instance, { callerId: 'agent-1' }) as SecretsExposure;
    const sec2 = secretsBinding.projection(instance, { callerId: 'agent-2' }) as SecretsExposure;

    await sec1.set('auth-token', 'token-for-agent-1');
    await sec2.set('auth-token', 'token-for-agent-2');

    assert.equal(await sec1.get('auth-token'), 'token-for-agent-1');
    assert.equal(await sec2.get('auth-token'), 'token-for-agent-2');
  });

  it('boots inside real BrudKernel and resolves exposures across participants', async (t) => {
    delete (globalThis as { __dbTest?: unknown }).__dbTest;

    const callerA = `
      const report = ((globalThis.__dbTest ??= {})['callerA'] ??= {});
      export function createService() {
        return {
          token: { id: 'test.callerA', description: 'Caller A participant' },
          tier: 'userland',
          dependencies: [],
          manifest: {
            requests: { capabilities: [] },
            exposures: [],
            kinds: [],
            events: [],
          },
          factory: () => ({
            async onRunning(broker) {
              const registry = broker.requestAccess(
                { callerId: 'test.callerA', tier: 'userland', options: {} },
                { id: 'brud.core.exposedApiRegistry' }
              );
              const db = registry.resolve('brud.db');
              const secrets = registry.resolve('brud.secrets');

              if (db) {
                await db.set('state', { agent: 'A', value: 100 });
                report.dbValue = await db.get('state');
              }
              if (secrets) {
                await secrets.set('api_key', 'secret-A');
                report.secretValue = await secrets.get('api_key');
              }
            }
          })
        };
      }
    `;

    const callerB = `
      const report = ((globalThis.__dbTest ??= {})['callerB'] ??= {});
      export function createService() {
        return {
          token: { id: 'test.callerB', description: 'Caller B participant' },
          tier: 'userland',
          dependencies: [],
          manifest: {
            requests: { capabilities: [] },
            exposures: [],
            kinds: [],
            events: [],
          },
          factory: () => ({
            async onRunning(broker) {
              const registry = broker.requestAccess(
                { callerId: 'test.callerB', tier: 'userland', options: {} },
                { id: 'brud.core.exposedApiRegistry' }
              );
              const db = registry.resolve('brud.db');
              const secrets = registry.resolve('brud.secrets');

              if (db) {
                // Caller B reads 'state' before writing - should be null because Caller A's 'state' is isolated
                report.initialDbValue = await db.get('state');
                await db.set('state', { agent: 'B', value: 200 });
                report.dbValue = await db.get('state');
              }
              if (secrets) {
                report.initialSecretValue = await secrets.get('api_key');
                await secrets.set('api_key', 'secret-B');
                report.secretValue = await secrets.get('api_key');
              }
            }
          })
        };
      }
    `;

    await bootTestKernel(t, [
      { path: DB_PARTICIPANT_PATH },
      { source: callerA },
      { source: callerB },
    ]);

    const rA = reports()['callerA'];
    const rB = reports()['callerB'];

    assert.deepEqual(rA?.dbValue, { agent: 'A', value: 100 });
    assert.equal(rA?.secretValue, 'secret-A');

    // Caller B never saw Caller A's state or secret
    assert.equal(rB?.initialDbValue, null);
    assert.equal(rB?.initialSecretValue, null);
    assert.deepEqual(rB?.dbValue, { agent: 'B', value: 200 });
    assert.equal(rB?.secretValue, 'secret-B');
  });
});
