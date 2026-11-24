import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryDriver } from '../src/drivers/MemoryDriver.js';
import { FileDriver } from '../src/drivers/FileDriver.js';
import { SQLiteDriver } from '../src/drivers/SQLiteDriver.js';
import type { StorageDriver } from '../src/contracts/types.js';

describe('Storage Drivers Parity Test Suite', () => {
  const driverFactories: Array<{
    name: string;
    create: () => Promise<{ driver: StorageDriver; cleanup?: () => Promise<void> }>;
  }> = [
    {
      name: 'MemoryDriver',
      create: async () => ({
        driver: new MemoryDriver(),
      }),
    },
    {
      name: 'FileDriver',
      create: async () => {
        const dir = await mkdtemp(join(tmpdir(), 'brud-db-file-'));
        return {
          driver: new FileDriver(dir),
          cleanup: async () => {
            await rm(dir, { recursive: true, force: true });
          },
        };
      },
    },
    {
      name: 'SQLiteDriver (in-memory)',
      create: async () => ({
        driver: new SQLiteDriver(':memory:'),
      }),
    },
    {
      name: 'SQLiteDriver (file-backed)',
      create: async () => {
        const dir = await mkdtemp(join(tmpdir(), 'brud-db-sqlite-'));
        const dbPath = join(dir, 'test.sqlite');
        return {
          driver: new SQLiteDriver(dbPath),
          cleanup: async () => {
            await rm(dir, { recursive: true, force: true });
          },
        };
      },
    },
  ];

  for (const { name, create } of driverFactories) {
    describe(`Driver: ${name}`, () => {
      it('initializes and shuts down cleanly', async () => {
        const { driver, cleanup } = await create();
        try {
          await driver.initialize();
          await driver.shutdown();
        } finally {
          await cleanup?.();
        }
      });

      it('supports basic key-value CRUD operations', async () => {
        const { driver, cleanup } = await create();
        try {
          await driver.initialize();
          const ns = 'test-ns';

          assert.equal(await driver.has(ns, 'user:1'), false);
          assert.equal(await driver.get(ns, 'user:1'), null);

          await driver.set(ns, 'user:1', { name: 'Alice', age: 30 });
          assert.equal(await driver.has(ns, 'user:1'), true);
          assert.deepEqual(await driver.get(ns, 'user:1'), { name: 'Alice', age: 30 });

          await driver.set(ns, 'user:2', { name: 'Bob', age: 25 });
          await driver.set(ns, 'config:theme', 'dark');

          const allKeys = await driver.list(ns);
          assert.deepEqual(allKeys.sort(), ['config:theme', 'user:1', 'user:2']);

          const userKeys = await driver.list(ns, 'user:');
          assert.deepEqual(userKeys.sort(), ['user:1', 'user:2']);

          const deleted = await driver.delete(ns, 'user:1');
          assert.equal(deleted, true);
          assert.equal(await driver.has(ns, 'user:1'), false);
          assert.equal(await driver.get(ns, 'user:1'), null);

          const deletedAgain = await driver.delete(ns, 'user:1');
          assert.equal(deletedAgain, false);
        } finally {
          await driver.shutdown();
          await cleanup?.();
        }
      });

      it('isolates data between different namespaces', async () => {
        const { driver, cleanup } = await create();
        try {
          await driver.initialize();
          const nsA = 'tenant-a';
          const nsB = 'tenant-b';

          await driver.set(nsA, 'shared-key', 'secret-a');
          await driver.set(nsB, 'shared-key', 'secret-b');

          assert.equal(await driver.get(nsA, 'shared-key'), 'secret-a');
          assert.equal(await driver.get(nsB, 'shared-key'), 'secret-b');

          const listA = await driver.list(nsA);
          const listB = await driver.list(nsB);
          assert.deepEqual(listA, ['shared-key']);
          assert.deepEqual(listB, ['shared-key']);

          await driver.delete(nsA, 'shared-key');
          assert.equal(await driver.has(nsA, 'shared-key'), false);
          assert.equal(await driver.has(nsB, 'shared-key'), true);
          assert.equal(await driver.get(nsB, 'shared-key'), 'secret-b');
        } finally {
          await driver.shutdown();
          await cleanup?.();
        }
      });

      it('supports secrets CRUD operations', async () => {
        const { driver, cleanup } = await create();
        try {
          await driver.initialize();
          const ns = 'secrets-ns';

          assert.equal(await driver.hasSecret(ns, 'api-key'), false);
          assert.equal(await driver.getSecret(ns, 'api-key'), null);

          const record1 = {
            key: 'api-key',
            cipherText: 'encrypted-blob-1',
            iv: 'iv-1',
            tag: 'tag-1',
            version: 1,
            createdAt: 1000,
            metadata: { owner: 'agent-1' },
          };

          await driver.setSecret(ns, record1);
          assert.equal(await driver.hasSecret(ns, 'api-key'), true);

          const fetched = await driver.getSecret(ns, 'api-key');
          assert.deepEqual(fetched, record1);

          const list = await driver.listSecrets(ns);
          assert.equal(list.length, 1);
          assert.equal(list[0]?.key, 'api-key');
          assert.equal(list[0]?.version, 1);
          assert.equal(list[0]?.createdAt, 1000);
          assert.deepEqual(list[0]?.metadata, { owner: 'agent-1' });
          // Ensure ciphertext / iv / tag are not exposed in listSecrets metadata
          assert.equal('cipherText' in (list[0] as object), false);
          assert.equal('iv' in (list[0] as object), false);

          const deleted = await driver.deleteSecret(ns, 'api-key');
          assert.equal(deleted, true);
          assert.equal(await driver.hasSecret(ns, 'api-key'), false);
          assert.equal(await driver.getSecret(ns, 'api-key'), null);
        } finally {
          await driver.shutdown();
          await cleanup?.();
        }
      });
    });
  }

  describe('File-backed persistence across restart', () => {
    it('FileDriver persists data across shutdown and re-initialization', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'brud-db-file-restart-'));
      try {
        const driver1 = new FileDriver(dir);
        await driver1.initialize();
        await driver1.set('ns1', 'k1', 'v1');
        await driver1.shutdown();

        const driver2 = new FileDriver(dir);
        await driver2.initialize();
        assert.equal(await driver2.get('ns1', 'k1'), 'v1');
        await driver2.shutdown();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('SQLiteDriver persists data across shutdown and re-initialization', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'brud-db-sqlite-restart-'));
      const dbPath = join(dir, 'test-restart.sqlite');
      try {
        const driver1 = new SQLiteDriver(dbPath);
        await driver1.initialize();
        await driver1.set('ns1', 'k1', { hello: 'world' });
        await driver1.shutdown();

        const driver2 = new SQLiteDriver(dbPath);
        await driver2.initialize();
        assert.deepEqual(await driver2.get('ns1', 'k1'), { hello: 'world' });
        await driver2.shutdown();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
});
