import type { IBrandScope } from '../contracts/IBrandScope.js';
import { BrandTargetError } from '../contracts/errors.js';

/**
 * One certification scope.
 *
 * The marker symbol is created per scope and never exported. Verification
 * requires both the hidden symbol property and membership in the scope's
 * private WeakSet, so a symbol copied onto another object cannot be forged.
 */
export class BrandScope implements IBrandScope {
  public readonly name: string;

  readonly #marker: symbol;

  readonly #branded = new WeakSet<object>();

  constructor(name: string) {
    this.name = name;
    this.#marker = Symbol(`brud.brand.scope.${name}`);
  }

  public brand<TTarget extends object>(target: TTarget): TTarget {
    if (target === null || (typeof target !== 'object' && typeof target !== 'function')) {
      throw new BrandTargetError('target must be a non-null object');
    }

    if (this.#branded.has(target)) {
      return target;
    }

    try {
      Object.defineProperty(target, this.#marker, {
        configurable: false,
        enumerable: false,
        value: true,
        writable: false,
      });
    } catch (error: unknown) {
      throw new BrandTargetError(
        error instanceof Error ? error.message : 'target is not extensible',
      );
    }

    this.#branded.add(target);

    return target;
  }

  public verify(target: unknown): boolean {
    if (target === null || (typeof target !== 'object' && typeof target !== 'function')) {
      return false;
    }

    if (!this.#branded.has(target)) {
      return false;
    }

    const descriptor = Object.getOwnPropertyDescriptor(target, this.#marker);

    return descriptor !== undefined
      && descriptor.value === true
      && descriptor.enumerable === false;
  }
}

/**
 * Builds a standalone scope outside a kernel registry.
 *
 * Used by package-internal certification helpers and unit tests. Production
 * services should obtain scopes from {@link BrandRegistryService} so names are
 * unique and creation is confined to the boot window.
 */
export function createStandaloneBrandScope(name: string): IBrandScope {
  return new BrandScope(name);
}