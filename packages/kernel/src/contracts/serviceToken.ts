/**
 * A phantom-branded capability token identifying a service within the kernel.
 *
 * The brand is represented by a tuple so the wrapped service interface is
 * preserved invariantly. Consumers must never read `_brand` at runtime; it
 * exists purely to carry `TService` through registration and lookup.
 *
 * @typeParam TService - The public interface exposed by the service.
 */
export interface ServiceToken<TService> {
  /** Stable, human-readable identifier used for diagnostics and policies. */
  readonly id: string;

  /** Short explanation of what the service provides. */
  readonly description: string;

  /** Phantom brand preserving `TService` for strict type inference. */
  readonly _brand: readonly [TService];
}

/**
 * Creates a service token for the given identifier and description.
 *
 * @typeParam TService - The public interface exposed by the service.
 * @param id - Stable identifier for the service.
 * @param description - Short explanation of what the service provides.
 * @returns A phantom-branded token bound to `TService`.
 */
export function createServiceToken<TService>(id: string, description: string): ServiceToken<TService> {
  return {
    id,
    description,
    _brand: [] as unknown as readonly [TService],
  };
}

/**
 * Extracts the public service interface carried by a service token.
 *
 * @typeParam TToken - A {@link ServiceToken} type.
 */
export type InferService<TToken> = TToken extends ServiceToken<infer TService> ? TService : never;
