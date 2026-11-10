import { isCapabilityToken } from '../../../src/contracts/capability.js';

/**
 * Capabilities a plugin may declare in its manifest.
 *
 * The type is open: a plugin may declare any shape-valid capability token,
 * including one no service has registered. A permission is a declaration of
 * intent, not a grant; the plugin manager still projects every capability
 * handle through a scoped facade that enforces the declared permission set at
 * call time.
 */
export type PluginPermission = string;

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
  'actions:register',
  'terminal:execute',
  'telemetry:emit',
  'settings:read',
  'settings:write',
  'validation:read',
  'workspace:read',
  'plugins:manage',
];

/**
 * Capability handles a plugin context can expose.
 */
export type PluginCapability =
  | 'fileSystem'
  | 'universalHistory'
  | 'tools'
  | 'actions'
  | 'terminal';

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
  tools: ['tools:register', 'tools:execute'],
  actions: ['actions:register'],
  terminal: ['terminal:execute'],
};

/**
 * Determines whether a value is a shape-valid capability token.
 *
 * Membership is intentionally open. The kernel validates shape only; whether
 * any service exposes something for the token is resolved by the Exposed API
 * Registry at context-construction time.
 *
 * @param value - Candidate value, typically sourced from an untrusted manifest.
 * @returns `true` when the value is a valid {@link PluginPermission}.
 */
export function isPluginPermission(value: unknown): value is PluginPermission {
  return isCapabilityToken(value);
}
