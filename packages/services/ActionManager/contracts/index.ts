export type {
  ActionRegistrationOptions,
  IActionDisposable,
  IActionExecutionContext,
  IActionManager,
  IActionManagerReader,
  RegisteredActionInfo,
} from './IActionManager.js';
export {
} from './IActionManager.js';
export type { ActionManagerErrorCode } from './errors.js';
export {
  ActionDisposedError,
  ActionDuplicateError,
  ActionManagerError,
  ActionNotFoundError,
  ActionQuotaExceededError,
  ActionRegistrationError,
  ActionValidationError,
  actionFailureMessage,
} from './errors.js';export * from './exposure.js';
