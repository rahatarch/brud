export { UnifiedHistoryService, isCoreNamespace, isReservedNamespace } from './UnifiedHistoryService.js';
export type { NamespaceHandleOptions, UnifiedHistoryServiceOptions } from './UnifiedHistoryService.js';
export { createReadOnlyNamespaceHandle } from './NamespaceHandle.js';
export {
  BUILTIN_ENTRY_TYPES,
  CORE_NAMESPACE,
  FILE_ENTRY_TYPE,
  SESSION_TARGET_ENTRY_TYPE,
} from './builtinTypes.js';
export type { FileEntryPayload, SessionTargetPayload } from './builtinTypes.js';
export * from './errors.js';
export { BINARY_PROBE_LENGTH, isBinaryContent, normalizeTargetPath } from './targets.js';
export type * from './types.js';
