export type { PluginPermission, PluginCapability } from './permissions.js';
export {
  CAPABILITY_PERMISSION_REQUIREMENTS,
  PLUGIN_PERMISSIONS,
  isPluginPermission,
} from './permissions.js';

export type {
  PluginManifest,
  PluginManifestValidationFailure,
  PluginManifestValidationResult,
  PluginManifestValidationSuccess,
} from './manifest.js';
export { PLUGIN_ID_PATTERN, SEMVER_PATTERN, validatePluginManifest } from './manifest.js';

export type {
  IPluginContext,
  IPluginDisposable,
  IPluginLogger,
  IPluginSubscriptions,
} from './IPluginContext.js';
export { PluginSubscriptions } from './PluginSubscriptions.js';
export { PluginContext } from './PluginContext.js';
export type { PluginCapabilityProviders, PluginContextOptions } from './PluginContext.js';

export type { IBrudPlugin } from './IBrudPlugin.js';

export type { IPluginManagerService, PluginRecord, PluginState } from './IPluginManager.js';
export { resolveActivationOrder, resolveDeactivationOrder } from './activationOrder.js';

export type {
  PluginDependencyErrorOptions,
  PluginErrorCode,
  PluginLifecyclePhase,
} from './errors.js';
export {
  PluginDependencyError,
  PluginDuplicateError,
  PluginError,
  PluginLifecycleError,
  PluginNotFoundError,
  PluginPermissionError,
} from './errors.js';

export { PluginManagerToken } from './tokens.js';
