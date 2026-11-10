import type { IExposedApiRegistry } from './IExposedApiRegistry.js';

/**
 * Implemented by a Level-1 service that exposes APIs at boot.
 *
 * The standard composition invokes the hook while the broker gate is
 * suspended, before `RUNNING`, and then calls
 * {@link IExposedApiRegistry.closeRegistration}.
 */
export interface IExposedApiRegistrant {
  /** Declares this service's exposed APIs. */
  registerWithApiRegistry(registry: IExposedApiRegistry): void;
}

/**
 * Narrows an initialized service to {@link IExposedApiRegistrant}.
 *
 * @param value - Constructed kernel service.
 */
export function isExposedApiRegistrant(value: unknown): value is IExposedApiRegistrant {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  return typeof (value as { readonly registerWithApiRegistry?: unknown })
    .registerWithApiRegistry === 'function';
}

/**
 * Attaches a boot-time exposure declaration to a service instance.
 *
 * Descriptors use this instead of adding registry methods to every service
 * class. The method is non-enumerable so it never appears in service
 * projections or diagnostics.
 *
 * @param instance - Service instance returned by a descriptor factory.
 * @param declare - Callback invoked with the Registry during boot.
 */
export function withExposedApis<T extends object>(
  instance: T,
  declare: (registry: IExposedApiRegistry) => void,
): T {
  Object.defineProperty(instance, 'registerWithApiRegistry', {
    value: declare,
    enumerable: false,
    configurable: true,
    writable: false,
  });

  return instance;
}