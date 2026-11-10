import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BrandRegistryClosedError,
  DuplicateBrandScopeError,
} from '../contracts/errors.js';
import { createStandaloneBrandScope } from '../orchestrator/BrandScope.js';
import {
  BrandRegistryService,
  createBrandRegistry,
} from '../orchestrator/BrandRegistryService.js';

describe('brand registry scopes', () => {
  it('brands and verifies a target through one scope', () => {
    const registry = createBrandRegistry();
    const scope = registry.createScope('acme.synthetic');
    const item = { kind: 'item' };

    assert.equal(scope.brand(item), item);
    assert.equal(scope.verify(item), true);
    assert.equal(scope.verify({ kind: 'item' }), false);
  });

  it('does not let another scope verify the first scope brand', () => {
    const registry = createBrandRegistry();
    const first = registry.createScope('acme.first');
    const second = registry.createScope('acme.second');
    const item = first.brand({ kind: 'item' });

    assert.equal(first.verify(item), true);
    assert.equal(second.verify(item), false);
  });

  it('cannot forge a brand by copying the marker symbol', () => {
    const registry = createBrandRegistry();
    const scope = registry.createScope('acme.first');
    const branded = scope.brand({ kind: 'item' });
    const marker = Object.getOwnPropertySymbols(branded)[0];

    assert.ok(marker !== undefined);

    const forged: Record<symbol, true> = { [marker]: true };

    assert.equal(scope.verify(forged), false);
  });

  it('branding is idempotent and returns the same target', () => {
    const scope = createStandaloneBrandScope('acme.idempotent');
    const item = {};

    assert.equal(scope.brand(item), item);
    assert.equal(scope.brand(item), item);
    assert.equal(scope.verify(item), true);
  });

  it('exposes scope names and lookup by name', () => {
    const registry = createBrandRegistry();
    const scope = registry.createScope('acme.org.scope');

    assert.equal(registry.getScope('acme.org.scope'), scope);
    assert.equal(registry.getScope('acme.org'), undefined);
    assert.deepEqual(registry.listScopeNames(), ['acme.org.scope']);
  });

  it('rejects duplicate scope names', () => {
    const registry = createBrandRegistry();
    registry.createScope('acme.duplicate');

    assert.throws(
      () => registry.createScope('acme.duplicate'),
      (error: unknown) => {
        assert.ok(error instanceof DuplicateBrandScopeError);
        assert.equal(error.name, 'DuplicateBrandScopeError');
        assert.equal(error.scopeName, 'acme.duplicate');
        return true;
      },
    );
  });

  it('rejects new scopes after the registration window closes', () => {
    const registry = new BrandRegistryService();
    registry.createScope('acme.early');
    registry.closeRegistration();

    assert.throws(
      () => registry.createScope('acme.late'),
      (error: unknown) => {
        assert.ok(error instanceof BrandRegistryClosedError);
        assert.equal(error.name, 'BrandRegistryClosedError');
        return true;
      },
    );

    // Existing scopes still brand after the window closes.
    const existing = registry.getScope('acme.early');

    assert.ok(existing !== undefined);
    assert.equal(existing.verify(existing.brand({})), true);
  });
});