import type { IRouterService } from './IRouterService.js';

/**
 * Implemented by a Level-1 service that wants to claim a kind at boot.
 *
 * The standard composition calls the hook while the kernel is still BOOTING
 * and the access broker's lifecycle gate is suspended, before the router
 * seals its registration window.
 */
export interface IRouterRegistrant {
  /**
   * Claims one or more kinds on the router.
   *
   * @param router - Router accepting boot-time registrations.
   */
  registerWithRouter(router: IRouterService): void;
}

/**
 * Narrows an unknown initialized service to {@link IRouterRegistrant}.
 *
 * @param value - Constructed kernel service.
 * @returns `true` when the service declares {@link IRouterRegistrant}.
 */
export function isRouterRegistrant(value: unknown): value is IRouterRegistrant {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  return typeof (value as { readonly registerWithRouter?: unknown }).registerWithRouter
    === 'function';
}