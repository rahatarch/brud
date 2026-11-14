import type { ExposedApiBinding } from './types.js';

/**
 * Implemented by a participant whose code binds its declared exposures.
 *
 * The participant's manifest declares its exposures; the kernel registers them
 * at boot from that data. On the first resolve of an exposure, the registry
 * asks the owner's code for the binding of that declared exposure. Code can
 * only bind what the manifest declared: it cannot add an exposure.
 */
export interface IExposureProvider {
  /**
   * Returns the binding for one declared exposure, or `undefined` when the
   * code does not provide it.
   *
   * @param name - Declared exposure name.
   * @param major - Declared major version.
   */
  provideExposure(name: string, major: number): ExposedApiBinding | undefined;
}

/**
 * Narrows an initialized instance to {@link IExposureProvider}.
 *
 * @param value - Initialized participant instance.
 */
export function isExposureProvider(value: unknown): value is IExposureProvider {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return false;
  }

  return typeof (value as { readonly provideExposure?: unknown }).provideExposure === 'function';
}

/** Key of one binding: `name@major`. */
export function exposureBindingKey(name: string, major: number): string {
  return `${name}@${String(major)}`;
}

/**
 * Attaches exposure bindings to an instance its factory returns.
 *
 * The method is non-enumerable so it never appears in projections or
 * diagnostics. A binding key is `name@major`.
 *
 * @param instance - Instance returned by a descriptor factory.
 * @param bindings - Bindings for the exposures the manifest declares.
 */
export function withExposureBindings<T extends object>(
  instance: T,
  bindings: Readonly<Record<string, ExposedApiBinding>>,
): T {
  const frozen = Object.freeze({ ...bindings });

  Object.defineProperty(instance, 'provideExposure', {
    value: (name: string, major: number): ExposedApiBinding | undefined =>
      Object.prototype.hasOwnProperty.call(frozen, exposureBindingKey(name, major))
        ? frozen[exposureBindingKey(name, major)]
        : undefined,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  return instance;
}
