import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseService } from '../src/core/DatabaseService.js';

describe('DatabaseService Core Multi-tenant Layer', () => {
  it('computes deterministic, collision-resistant namespace hashes', () => {
    const service = new DatabaseService({ driver: 'memory' });

    const ns1 = service.getNamespace('agent-alpha');
    const ns2 = service.getNamespace('agent-alpha');
    const ns3 = service.getNamespace('agent-beta');
    const nsAnon1 = service.getNamespace();
    const nsAnon2 = service.getNamespace('');

    assert.equal(ns1, ns2);
    assert.notEqual(ns1, ns3);
    assert.equal(nsAnon1, nsAnon2);
  });

  it('performs document CRUD and atomic partial updates', async () => {
    const service = new DatabaseService({ driver: 'memory' });
    const ns = service.getNamespace('caller-1');

    await service.set(ns, 'profile', { name: 'Rahat', role: 'architect' });
    assert.deepEqual(await service.get(ns, 'profile'), { name: 'Rahat', role: 'architect' });

    // Update with patch
    const updated = await service.update<{ name: string; role: string; level: number }>(
      ns,
      'profile',
      { level: 10 } as { level: number },
    );
    assert.deepEqual(updated, { name: 'Rahat', role: 'architect', level: 10 });
    assert.deepEqual(await service.get(ns, 'profile'), { name: 'Rahat', role: 'architect', level: 10 });

    // Update non-existing document creates it
    const created = await service.update(ns, 'non-existent', { created: true });
    assert.deepEqual(created, { created: true });
    assert.deepEqual(await service.get(ns, 'non-existent'), { created: true });
  });

  it('manages secrets with automatic version increments and encryption', async () => {
    const service = new DatabaseService({ driver: 'memory', encryptionKey: 'test-vault-key' });
    const ns = service.getNamespace('agent-security');

    assert.equal(await service.getSecret(ns, 'db_password'), null);

    // Initial set -> version 1
    await service.setSecret(ns, 'db_password', 'p@ssword123', { env: 'production' });
    assert.equal(await service.getSecret(ns, 'db_password'), 'p@ssword123');

    let list = await service.listSecrets(ns);
    assert.equal(list.length, 1);
    assert.equal(list[0]?.key, 'db_password');
    assert.equal(list[0]?.version, 1);
    assert.deepEqual(list[0]?.metadata, { env: 'production' });

    // Update secret -> version 2
    await service.setSecret(ns, 'db_password', 'p@ssword456_updated', { env: 'production', rotated: true });
    assert.equal(await service.getSecret(ns, 'db_password'), 'p@ssword456_updated');

    list = await service.listSecrets(ns);
    assert.equal(list.length, 1);
    assert.equal(list[0]?.version, 2);
    assert.deepEqual(list[0]?.metadata, { env: 'production', rotated: true });

    // Delete
    const deleted = await service.deleteSecret(ns, 'db_password');
    assert.equal(deleted, true);
    assert.equal(await service.getSecret(ns, 'db_password'), null);
    assert.equal(await service.hasSecret(ns, 'db_password'), false);
  });

  it('strictly isolates callers in both documents and secrets', async () => {
    const service = new DatabaseService({ driver: 'memory' });
    const nsA = service.getNamespace('tenant-alpha');
    const nsB = service.getNamespace('tenant-beta');

    await service.set(nsA, 'config', { allowed: true });
    await service.set(nsB, 'config', { allowed: false });

    await service.setSecret(nsA, 'api_token', 'token-alpha');
    await service.setSecret(nsB, 'api_token', 'token-beta');

    assert.deepEqual(await service.get(nsA, 'config'), { allowed: true });
    assert.deepEqual(await service.get(nsB, 'config'), { allowed: false });

    assert.equal(await service.getSecret(nsA, 'api_token'), 'token-alpha');
    assert.equal(await service.getSecret(nsB, 'api_token'), 'token-beta');

    // Tenant A deletes its token, Tenant B is unaffected
    await service.deleteSecret(nsA, 'api_token');
    assert.equal(await service.hasSecret(nsA, 'api_token'), false);
    assert.equal(await service.hasSecret(nsB, 'api_token'), true);
    assert.equal(await service.getSecret(nsB, 'api_token'), 'token-beta');
  });

  it('rejects invalid or empty keys to protect primary key integrity', async () => {
    const service = new DatabaseService({ driver: 'memory' });
    const ns = service.getNamespace('tenant-alpha');

    await assert.rejects(
      async () => service.set(ns, '', 'val'),
      /Storage key must be a non-empty string/,
    );
    await assert.rejects(
      async () => service.get(ns, '   '),
      /Storage key must be a non-empty string/,
    );
    await assert.rejects(
      async () => service.setSecret(ns, '', 'plaintext'),
      /Storage key must be a non-empty string/,
    );
  });
});
