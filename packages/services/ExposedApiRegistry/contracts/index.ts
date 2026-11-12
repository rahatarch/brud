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
export type {
  ExposedApiAccessContext,
  ExposedApiCaller,
  ExposedApiCombiner,
  ExposedApiEntry,
  ExposedApiProjection,
  ExposedApiRegistration,
} from './types.js';
export type { ExposedApiErrorCode } from './errors.js';
export {
  ExposedApiDisposedError,
  ExposedApiDuplicateCapabilityError,
  ExposedApiError,
  ExposedApiInvalidCapabilityError,
  ExposedApiInvalidNameError,
  ExposedApiNameCollisionError,
  ExposedApiRegistrationClosedError,
  ExposedApiUnknownServiceError,
} from './errors.js';