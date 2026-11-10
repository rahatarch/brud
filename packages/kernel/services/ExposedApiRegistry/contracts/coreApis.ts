/**
 * Stable names for the kernel's built-in exposed APIs.
 *
 * Services register under these names; consumers resolve them. The Registry
 * itself never references this table.
 */
export const CORE_API_NAME = Object.freeze({
  fileSystem: 'filesystem',
  universalHistory: 'universalHistory',
  namespaceHistory: 'history',
  brudTools: 'tools',
  actionManager: 'actions',
  utilities: 'utilities',
  terminal: 'terminal',
  settings: 'settings',
  settingsReader: 'settingsReader',
  validation: 'validation',
  workspace: 'workspace',
  pluginManager: 'pluginManager',
} as const);

/** Union of the built-in API names. */
export type CoreApiName = typeof CORE_API_NAME[keyof typeof CORE_API_NAME];

/**
 * Default combiner: the last matching projection wins.
 *
 * Read/write pairs use this so a caller holding the broader capability gets
 * the broader projection regardless of registration order.
 */
export function lastProjectionWins(
  projections: readonly unknown[],
): unknown {
  return projections.length === 0
    ? null
    : projections[projections.length - 1];
}

/**
 * Identity projection.
 *
 * @param service - Resolved service instance.
 */
export function identityProjection(service: unknown): unknown {
  return service;
}