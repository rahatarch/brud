import type { IServiceLifecycle } from '../../../src/contracts/lifecycle.js';
import { BrandRegistryClosedError, BrandScopeNameError, DuplicateBrandScopeError } from '../contracts/errors.js';
import type { IBrandRegistry } from '../contracts/IBrandRegistry.js';
import type { IBrandScope } from '../contracts/IBrandScope.js';
import { BrandScope } from './BrandScope.js';

/**
 * Kernel-wide registry of named brand scopes.
 *
 * The registry is open while the kernel boots and closes itself in the
 * `onRunning` hook, so every service factory can create its scope during boot
 * while late callers cannot create new ones. Existing scopes can brand and
 * verify for the rest of the kernel lifetime.
 */
export class BrandRegistryService implements IBrandRegistry, IServiceLifecycle {
  readonly #scopes = new Map<string, IBrandScope>();

  #open = true;

  public createScope(name: string): IBrandScope {
    if (typeof name !== 'string' || name.length === 0) {
      throw new BrandScopeNameError(name);
    }

    if (!this.#open) {
      throw new BrandRegistryClosedError(name);
    }

    if (this.#scopes.has(name)) {
      throw new DuplicateBrandScopeError(name);
    }

    const scope = new BrandScope(name);
    this.#scopes.set(name, scope);

    return scope;
  }

  public getScope(name: string): IBrandScope | undefined {
    return this.#scopes.get(name);
  }

  public listScopeNames(): readonly string[] {
    return [...this.#scopes.keys()];
  }

  public closeRegistration(): void {
    this.#open = false;
  }

  /** Closes the registration window once the kernel reaches `RUNNING`. */
  public onRunning(): void {
    this.closeRegistration();
  }
}

/** Builds a standalone registry for embedding and tests. */
export function createBrandRegistry(): BrandRegistryService {
  return new BrandRegistryService();
}