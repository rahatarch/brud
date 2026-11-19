import type { ExposedApiCaller } from '@brud/kernel';
import type { ExposureHandle, ParticipantContext } from './defineParticipant.js';

/** Methods one capability (or the shared part) contributes to a handle. */
export type Surface<TInstance extends object> = (
  ctx: ParticipantContext<TInstance>,
  caller: ExposedApiCaller,
) => Record<string, unknown>;

/**
 * Builds a handle shaped by the caller's capabilities: each listed capability
 * the caller holds adds its surface; `shared` is added for any admitted caller;
 * a caller holding none of the listed capabilities gets `null` (refused).
 *
 * ```ts
 * handle: byCapability(
 *   { 'notes:write': (ctx) => ({ add: … }), 'notes:admin': (ctx) => ({ purge: … }) },
 *   { shared: (ctx) => ({ list: … }) },
 * )
 * ```
 */
export function byCapability<TInstance extends object>(
  surfaces: Readonly<Record<string, Surface<TInstance>>>,
  options?: { readonly shared?: Surface<TInstance> },
): ExposureHandle<TInstance> {
  return (caller, ctx) => {
    const granted = Object.entries(surfaces).filter(([capability]) => caller.capabilities.has(capability));

    if (granted.length === 0) {
      return null;
    }

    return Object.freeze(Object.assign(
      {},
      options?.shared?.(ctx, caller),
      ...granted.map(([, surface]) => surface(ctx, caller)),
    ) as object);
  };
}
