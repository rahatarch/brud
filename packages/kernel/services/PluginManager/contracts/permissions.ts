/**
 * Capabilities a plugin may declare in its manifest.
 *
 * A permission is a declaration of intent, not a grant: the plugin manager
 * still projects every capability handle through a scoped facade that enforces
 * the declared permission set at call time.
 */
export type PluginPermission =
  | 'fs:read'
  | 'fs:write'
  | 'history:read'
  | 'history:write'
  | 'tools:register'
  | 'tools:execute'
  | 'telemetry:emit';

/**
 * Every permission understood by the kernel, in stable declaration order.
 *
 * The order is part of the contract: permission diagnostics and manifests
 * normalized by consumers must remain deterministic.
 */
export const PLUGIN_PERMISSIONS: readonly PluginPermission[] = [
  'fs:read',
  'fs:write',
  'history:read',
  'history:write',
  'tools:register',
  'tools:execute',
  'telemetry:emit',
];

/**
 * Capability handles a plugin context can expose.
 */
export type PluginCapability = 'fileSystem' | 'universalHistory';

/**
 * Permissions that unlock each capability handle.
 *
 * A plugin holding any one of the listed permissions may request the handle.
 * Read/write scoping within the handle is enforced by the projected facade,
 * never by the raw service.
 */
export const CAPABILITY_PERMISSION_REQUIREMENTS: Readonly<
  Record<PluginCapability, readonly PluginPermission[]>
> = {
  fileSystem: ['fs:read', 'fs:write'],
  universalHistory: ['history:read', 'history:write'],
};

/**
 * Determines whether a value is a declared plugin permission.
 *
 * @param value - Candidate value, typically sourced from an untrusted manifest.
 * @returns `true` when the value is a member of {@link PluginPermission}.
 */
export function isPluginPermission(value: unknown): value is PluginPermission {
  if (typeof value !== 'string') {
    return false;
  }

  return PLUGIN_PERMISSIONS.some((permission) => permission === value);
}
