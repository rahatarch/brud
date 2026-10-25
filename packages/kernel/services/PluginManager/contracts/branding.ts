/**
 * Unique, module-local certification symbol for first-party Brud plugins.
 *
 * The symbol is deliberately not exported through any package barrel: only
 * trusted kernel code can present it, and third-party plugins cannot obtain a
 * reference to forge official status.
 */
const OFFICIAL_PLUGIN_BRAND: unique symbol = Symbol('brud.kernel.plugin.official');

/**
 * Internal marker carried by plugins certified by the Brud kernel.
 *
 * A manifest cannot manufacture this marker because the symbol is unreachable
 * outside the internal branding module.
 */
export interface OfficialPluginBrand {
  readonly [OFFICIAL_PLUGIN_BRAND]: true;
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
 * Verifies that a candidate owns the genuine kernel branding symbol.
 *
 * The brand must be an own, non-enumerable property carrying the exact symbol
 * reference and a `true` value, so neither a string-named lookalike nor an
 * inherited property can pass the check.
 *
 * @param candidate - Value that may carry an official brand.
 * @returns `true` when the candidate is officially certified.
 */
export function hasOfficialPluginBrand(candidate: unknown): candidate is OfficialPluginBrand {
  if (typeof candidate !== 'object' || candidate === null) {
    return false;
  }

  const descriptor = Object.getOwnPropertyDescriptor(candidate, OFFICIAL_PLUGIN_BRAND);

  return descriptor !== undefined && descriptor.value === true && descriptor.enumerable === false;
}

/**
 * Marks a first-party plugin with the internal official brand.
 *
 * This helper is internal to the kernel. It is intentionally absent from the
 * public package barrels so third-party code cannot authorize itself.
 *
 * @param plugin - Plugin instance built by trusted first-party code.
 * @returns The same instance, now carrying the unforgeable brand.
 */
export function certifyOfficialPlugin<TPlugin extends object>(
  plugin: TPlugin,
): TPlugin & OfficialPluginBrand {
  if (hasOfficialPluginBrand(plugin)) {
    return plugin;
  }

  const brand: OfficialPluginBrand = { [OFFICIAL_PLUGIN_BRAND]: true };
  const branded = Object.assign(plugin, brand);

  Object.defineProperty(branded, OFFICIAL_PLUGIN_BRAND, {
    configurable: false,
    enumerable: false,
    writable: false,
  });

  return branded;
}
