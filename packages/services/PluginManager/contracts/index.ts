export type { PluginPermission, PluginCapability } from './permissions.js';
export {
  CAPABILITY_PERMISSION_REQUIREMENTS,
  PLUGIN_PERMISSIONS,
  isPluginPermission,
} from './permissions.js';

export type {
  OfficialPluginManifest,
  PluginManifest,
  PluginManifestBase,
  PluginManifestValidationFailure,
  PluginManifestValidationFailureReason,
  PluginManifestValidationOptions,
  PluginManifestValidationResult,
  PluginManifestValidationSuccess,
  ThirdPartyPluginManifest,
  PluginTransportKind,
} from './manifest.js';
export {
  PLUGIN_ID_PATTERN,
  PLUGIN_TRANSPORT_KINDS,
  SEMVER_PATTERN,
  validatePluginManifest,
} from './manifest.js';

export type {
  IPluginContext,
  IPluginDisposable,
  IPluginLogger,
  IPluginSubscriptions,
} from './IPluginContext.js';
export { PluginSubscriptions } from './PluginSubscriptions.js';
export { PluginContext } from './PluginContext.js';
export type { PluginCapabilityProviders, PluginContextOptions } from './PluginContext.js';

export type { ITerminalHandle, TerminalExecutionInfo } from './ITerminalHandle.js';
export { createTerminalHandle } from './TerminalHandle.js';
export type { TerminalHandleOptions } from './TerminalHandle.js';

export type { IMcpTransport } from './IMcpTransport.js';

export type { IBrudPlugin } from './IBrudPlugin.js';

export type { IPluginManagerService, PluginRecord, PluginState } from './IPluginManager.js';
export { resolveActivationOrder, resolveDeactivationOrder } from './activationOrder.js';

export type {
  PluginAuthorizationErrorOptions,
  PluginAuthorizationReason,
  PluginDependencyErrorOptions,
  PluginErrorCode,
  PluginLifecyclePhase,
} from './errors.js';
export {
  PluginAuthorizationError,
  PluginDependencyError,
  PluginDuplicateError,
  PluginError,
  PluginLifecycleError,
  PluginNotFoundError,
  PluginPermissionError,
} from './errors.js';

export { PluginManagerToken } from './tokens.js';
