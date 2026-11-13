export type { IExposedApiRegistry } from './IExposedApiRegistry.js';
export type { IExposedApiRegistrant } from './registrant.js';
export {
  isExposedApiRegistrant,
  withExposedApis,
} from './registrant.js';
export {
  CORE_API_NAME,
  identityProjection,
  lastProjectionWins,
  type CoreApiName,
} from './coreApis.js';
export {
  EXPOSED_API_NAME_PATTERN,
  EXPOSED_API_ORIGINS,
  EXPOSED_API_SCOPES,
  exposedApiScopeAllowsOrigin,
  exposedApiScopeRank,
  isExposedApiOrigin,
  isExposedApiScope,
  isExposedApiVersion,
} from './types.js';
export type {
  ExposedApiAccessContext,
  ExposedApiCaller,
  ExposedApiCombiner,
  ExposedApiEntry,
  ExposedApiIdentity,
  ExposedApiOrigin,
  ExposedApiPolicy,
  ExposedApiProjection,
  ExposedApiRegistration,
  ExposedApiResolved,
  ExposedApiScope,
  ExposedApiVersion,
} from './types.js';
export type { ExposedApiErrorCode } from './errors.js';
export {
  ExposedApiDisposedError,
  ExposedApiDuplicateCapabilityError,
  ExposedApiError,
  ExposedApiInvalidCapabilityError,
  ExposedApiInvalidNameError,
  ExposedApiInvalidPolicyError,
  ExposedApiInvalidScopeError,
  ExposedApiInvalidVersionError,
  ExposedApiNameCollisionError,
  ExposedApiRegistrationClosedError,
  ExposedApiScopeNarrowingError,
  ExposedApiScopeRecordCorruptError,
  ExposedApiScopeRecordPathError,
  ExposedApiScopeRecordWriteError,
  ExposedApiUnknownServiceError,
} from './errors.js';