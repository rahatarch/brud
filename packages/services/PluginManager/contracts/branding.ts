import { createStandaloneBrandScope } from '../../BrandRegistry/orchestrator/BrandScope.js';
import type { IBrandScope } from '../../BrandRegistry/contracts/IBrandScope.js';

/**
 * Package-internal default scope used by standalone plugin helpers.
 *
 * Production kernels create their own plugin-manager scope from the Brand
 * Registry. This scope keeps direct unit construction and legacy test helpers
 * working without reintroducing the old module-local symbol.
 */
const DEFAULT_OFFICIAL_SCOPE = createStandaloneBrandScope('brud.core.pluginManager');

/** Marker type retained for source compatibility with earlier helpers. */
export type OfficialPluginBrand = object;

/** Returns the package-internal scope used by standalone plugin helpers. */
export function getDefaultOfficialPluginScope(): IBrandScope {
  return DEFAULT_OFFICIAL_SCOPE;
}

/** Namespace prefixes owned exclusively by first-party Brud plugins. */
export const RESERVED_PLUGIN_ID_PREFIXES = ['brud.', '@brud/'] as const;

/**
 * Reports whether a plugin identifier claims a reserved first-party namespace.
 *
 * @param pluginId - Raw identifier from an untrusted manifest.
 * @returns `true` when the identifier starts with an official prefix.
 */
export function isReservedPluginId(pluginId: string): boolean {
  return RESERVED_PLUGIN_ID_PREFIXES.some((prefix) => pluginId.startsWith(prefix));
}

/**
 * Verifies that a candidate carries the package-internal official brand.
 *
 * @param candidate - Value that may carry an official brand.
 * @returns `true` when the candidate is certified by the default scope.
 */
export function hasOfficialPluginBrand(candidate: unknown): candidate is OfficialPluginBrand {
  return DEFAULT_OFFICIAL_SCOPE.verify(candidate);
}

/**
 * Marks a first-party plugin with the package-internal official brand.
 *
 * Production kernels brand through the Brand Registry scope created at boot;
 * this helper remains for standalone composition and existing tests.
 *
 * @param plugin - Plugin instance built by trusted first-party code.
 * @returns The same instance, now carrying the unforgeable brand.
 */
export function certifyOfficialPlugin<TPlugin extends object>(
  plugin: TPlugin,
): TPlugin {
  return DEFAULT_OFFICIAL_SCOPE.brand(plugin);
}