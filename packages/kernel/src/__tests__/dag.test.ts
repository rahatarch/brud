import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServiceToken } from '../contracts/serviceToken.js';
import type { ServiceToken } from '../contracts/serviceToken.js';
import type { ServiceDescriptor } from '../contracts/serviceDescriptor.js';
import { topologicalSort } from '../engine/dag.js';
import { CircularDependencyError, MissingDependencyError } from '../engine/errors.js';

function token(id: string): ServiceToken<unknown> {
  return createServiceToken<unknown>(id, `${id} service`);
}

function descriptor(
  id: string,
  dependencies: readonly ServiceToken<unknown>[] = [],
): ServiceDescriptor<unknown> {
  return {
    token: token(id),
    tier: 'core',
    dependencies,
    factory: () => ({
      initialize: () => undefined,
      dispose: () => undefined,
    }),
  };
}

function graph(
  entries: readonly ServiceDescriptor<unknown>[],
): ReadonlyMap<string, ServiceDescriptor<unknown>> {
  return new Map(entries.map((entry) => [entry.token.id, entry]));
}

function ids(entries: readonly ServiceDescriptor<unknown>[]): readonly string[] {
  return entries.map((entry) => entry.token.id);
}

describe('topologicalSort', () => {
  it('orders linear dependencies before their dependents regardless of registration order', () => {
    const a = token('a');
    const b = token('b');
    const c = token('c');

    const ordered = topologicalSort(graph([
      descriptor('c', [b]),
      descriptor('b', [a]),
      descriptor('a'),
    ]));

    assert.deepStrictEqual(ids(ordered), ['a', 'b', 'c']);
  });

  it('orders diamond dependencies with shared prerequisites first', () => {
    const b = token('b');
    const c = token('c');
    const d = token('d');

    const ordered = topologicalSort(graph([
      descriptor('a', [b, c]),
      descriptor('b', [d]),
      descriptor('c', [d]),
      descriptor('d'),
    ]));

    const position = new Map(ids(ordered).map((id, index) => [id, index]));
    const dIndex = position.get('d');
    const bIndex = position.get('b');
    const cIndex = position.get('c');
    const aIndex = position.get('a');

    assert.strictEqual(ordered.length, 4);
    assert.ok(dIndex !== undefined && bIndex !== undefined && cIndex !== undefined && aIndex !== undefined);
    assert.ok(dIndex < bIndex);
    assert.ok(dIndex < cIndex);
    assert.ok(bIndex < aIndex);
    assert.ok(cIndex < aIndex);
  });

  it('throws MissingDependencyError when a declared dependency is absent', () => {
    const missing = token('missing');

    assert.throws(
      () => topologicalSort(graph([descriptor('dependent', [missing])])),
      (error: unknown) => {
        assert.ok(error instanceof MissingDependencyError);
        assert.strictEqual(error.code, 'MISSING_DEPENDENCY');
        assert.strictEqual(error.missingTokenId, 'missing');
        assert.strictEqual(error.dependentTokenId, 'dependent');
        return true;
      },
    );
  });

  it('detects a self-referential cycle and reports the exact path', () => {
    assert.throws(
      () => topologicalSort(graph([descriptor('self', [token('self')])])),
      (error: unknown) => {
        assert.ok(error instanceof CircularDependencyError);
        assert.strictEqual(error.code, 'CIRCULAR_DEPENDENCY');
        assert.deepStrictEqual(error.cyclePath, ['self', 'self']);
        return true;
      },
    );
  });

  it('detects a multi-node cycle and reports the exact path', () => {
    const a = token('a');
    const b = token('b');
    const c = token('c');

    assert.throws(
      () => topologicalSort(graph([
        descriptor('a', [b]),
        descriptor('b', [c]),
        descriptor('c', [a]),
      ])),
      (error: unknown) => {
        assert.ok(error instanceof CircularDependencyError);
        assert.deepStrictEqual(error.cyclePath, ['a', 'b', 'c', 'a']);
        return true;
      },
    );
  });

  it('reports only the cyclic segment when the cycle is reached through a root', () => {
    const a = token('a');
    const b = token('b');

    assert.throws(
      () => topologicalSort(graph([
        descriptor('root', [a]),
        descriptor('a', [b]),
        descriptor('b', [a]),
      ])),
      (error: unknown) => {
        assert.ok(error instanceof CircularDependencyError);
        assert.deepStrictEqual(error.cyclePath, ['a', 'b', 'a']);
        return true;
      },
    );
  });

  it('returns an empty order for an empty graph', () => {
    assert.deepStrictEqual(topologicalSort(new Map()), []);
  });
});
