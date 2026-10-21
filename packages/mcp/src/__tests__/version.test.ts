import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { applyPackageVersion, resolvePackageVersion } from '../version.js';

describe('package version resolution', () => {
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

  it('reads the version from the manifest next to the entry point', () => {
    const entry = path.join(__dirname, '..', 'cli.ts');
    assert.equal(resolvePackageVersion(entry), '0.0.1');
  });

  it('returns undefined instead of throwing for an unknown entry point', () => {
    assert.equal(resolvePackageVersion(path.join(__dirname, 'does-not-exist.js')), undefined);
  });

  it('labels the process without overriding an explicit value', () => {
    const entry = path.join(__dirname, '..', 'cli.ts');
    applyPackageVersion(entry);
    assert.equal(process.env.BRUD_CLIENT_VERSION, '0.0.1');

    process.env.BRUD_CLIENT_VERSION = '9.9.9';
    applyPackageVersion(entry);
    assert.equal(process.env.BRUD_CLIENT_VERSION, '9.9.9');
  });
});
