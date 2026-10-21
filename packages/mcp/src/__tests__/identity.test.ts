import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveServerIdentity } from '../server.js';

describe('server identity', () => {
  let previous: string | undefined;

  beforeEach(() => {
    previous = process.env.BRUD_CLIENT_VERSION;
    delete process.env.BRUD_CLIENT_VERSION;
  });

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.BRUD_CLIENT_VERSION;
    } else {
      process.env.BRUD_CLIENT_VERSION = previous;
    }
  });

  it('returns an explicit identity unchanged', () => {
    const explicit = { name: 'custom', version: '9.8.7' };
    assert.deepEqual(resolveServerIdentity(explicit, '1.2.3'), explicit);
  });

  it('prefers the host client version over the environment', () => {
    process.env.BRUD_CLIENT_VERSION = '0.0.9';
    assert.deepEqual(resolveServerIdentity(undefined, '0.1.6'), {
      name: 'brud-code',
      version: '0.1.6',
    });
  });

  it('falls back to BRUD_CLIENT_VERSION when the host supplies none', () => {
    process.env.BRUD_CLIENT_VERSION = '0.0.9';
    assert.equal(resolveServerIdentity().version, '0.0.9');
  });

  it('reports an honest sentinel when nothing is known', () => {
    assert.deepEqual(resolveServerIdentity(), { name: 'brud-code', version: 'unknown' });
  });
});
