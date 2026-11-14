export type { IExposedApiAdmission, IExposedApiRegistry } from './IExposedApiRegistry.js';
export type { IExposureProvider } from './registrant.js';
export {
  exposureBindingKey,
  isExposureProvider,
  withExposureBindings,
} from './registrant.js';
export {
  EXPOSED_API_MAX_POLICY_BYTES,
  EXPOSED_API_POLICY_VERSION,
  evaluateExposedApiPolicy,
  parseExposedApiPolicy,
} from './policy.js';
export type { ExposedApiPolicy, ExposedApiPolicyDecision } from './policy.js';
export {
  EXPOSED_API_NAME_PATTERN,
  EXPOSED_API_ORIGINS,
  EXPOSED_API_SCOPES,
  exposedApiMajor,
  exposedApiScopeAllowsOrigin,
  exposedApiScopeRank,
  isExposedApiOrigin,
  isExposedApiScope,
  isExposedApiVersion,
} from './types.js';
export type {
  ExposedApiBinding,
  ExposedApiCaller,
  ExposedApiIdentity,
  ExposedApiOrigin,
  ExposedApiProjection,
  ExposedApiResolveOptions,
  ExposedApiScope,
  ExposedApiVersion,
} from './types.js';
export type { ExposedApiErrorCode } from './errors.js';
export {
  ExposedApiDisposedError,
  ExposedApiDuplicateExposureError,
  ExposedApiError,
  ExposedApiInvalidNameError,
  ExposedApiInvalidPolicyError,
  ExposedApiInvalidScopeError,
  ExposedApiInvalidVersionError,
  ExposedApiNameCollisionError,
  ExposedApiNotAttachedError,
  ExposedApiOwnerPinError,
  ExposedApiRegistrationClosedError,
  ExposedApiScopeNarrowingError,
  ExposedApiScopeRecordCorruptError,
  ExposedApiScopeRecordPathError,
  ExposedApiScopeRecordWriteError,
  ExposedApiUnavailableError,
} from './errors.js';
