export type {
  IdentityBinding,
  IdentityRecord,
  IdentityState,
  IdentityToken,
  IIdentityRegistry,
} from './contracts/types.js';
export { IDENTITY_STATES, isIdentityState } from './contracts/types.js';
export {
  IdentityRegistryCorruptError,
  IdentityRegistryError,
  IdentityRegistryFrozenError,
  IdentityRegistryInputError,
  IdentityRegistryMissingError,
  IdentityRegistryNotReadyError,
  IdentityRegistryPathError,
  IdentityRegistryRevokedError,
  IdentityRegistryStorageExistsError,
  IdentityRegistryUnknownTokenError,
  IdentityRegistryWriteError,
} from './contracts/errors.js';
export type { IdentityRegistryErrorCode } from './contracts/errors.js';
export {
  IDENTITY_REGISTRY_CONTEXT_SCOPE,
  IDENTITY_REGISTRY_PATH_CONTEXT_FIELD,
  IDENTITY_REGISTRY_SERVICE_TIER,
  createIdentityRegistryDescriptor,
} from './descriptor/descriptor.js';
export type { IdentityRegistryDescriptorOptions } from './descriptor/descriptor.js';
export { IdentityRegistryToken } from './descriptor/tokens.js';
export {
  IdentityRegistryService,
  createIdentityRegistry,
} from './orchestrator/IdentityRegistryService.js';
export type { IdentityRegistryServiceOptions } from './orchestrator/IdentityRegistryService.js';
export {
  IDENTITY_REGISTRY_FORMAT,
  IDENTITY_REGISTRY_MAX_METADATA_BYTES,
  IDENTITY_REGISTRY_MAX_OPAQUE_LENGTH,
  IDENTITY_REGISTRY_VERSION,
  loadIdentityRegistryStorage,
  parseIdentityRegistryDocument,
  persistIdentityRegistryStorage,
  provisionIdentityRegistryStorage,
  serializeIdentityRegistryDocument,
} from './storage/registryDocument.js';
export type { LoadedIdentityRegistry } from './storage/registryDocument.js';