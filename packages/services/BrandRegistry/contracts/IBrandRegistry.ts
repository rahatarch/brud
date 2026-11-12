import type { IBrandScope } from './IBrandScope.js';

/**
 * Universal brand registry service contract.
 *
 * Any service, first-party or third-party, may create its own named scope
 * during the boot window and use it to certify and later verify its own
 * sub-items. Scope names are unique across a kernel; dot-separated names are
 * organizational only and grant no authority over other names.
 */
export interface IBrandRegistry {
  /**
   * Creates and registers a new scope.
   *
   * Only valid during the boot window. Throws after the registry closes.
   *
   * @param name - Unique scope name.
   * @returns The newly created opaque scope.
   */
  createScope(name: string): IBrandScope;

  /** Returns the scope registered under `name`, if any. */
  getScope(name: string): IBrandScope | undefined;

  /** Lists every registered scope name in registration order. */
  listScopeNames(): readonly string[];

  /**
   * Closes the boot registration window.
   *
   * Existing scopes keep working, and branding remains allowed. Only new
   * scope creation is forbidden after this call.
   */
  closeRegistration(): void;
}