/** Stable, machine-readable codes for ActionManager domain failures. */
export type ActionManagerErrorCode =
  | 'ACTION_DUPLICATE'
  | 'ACTION_NOT_FOUND'
  | 'ACTION_VALIDATION_ERROR'
  | 'ACTION_DISPOSED'
  | 'ACTION_QUOTA_EXCEEDED'
  | 'ACTION_REGISTRATION_ERROR';

/**
 * Base class for every ActionManager domain failure.
 *
 * Subclasses carry a stable {@link ActionManagerErrorCode} so hosts can branch
 * on failures without parsing human-readable messages.
 */
export abstract class ActionManagerError extends Error {
  /** Stable, machine-readable error code. */
  public abstract readonly code: ActionManagerErrorCode;

  /**
   * @param message - Human-readable failure description.
   * @param options - Optional native error options, including `cause`.
   */
  protected constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ActionManagerError';
  }
}

/** Raised when an action name is registered more than once. */
export class ActionDuplicateError extends ActionManagerError {
  public readonly code = 'ACTION_DUPLICATE' as const;

  /** Name that was registered twice. */
  public readonly actionName: string;

  /** Plugin that already owns the name. */
  public readonly ownerPluginId: string;

  /**
   * @param actionName - Duplicated action name.
   * @param ownerPluginId - Plugin that already owns the name.
   */
  constructor(actionName: string, ownerPluginId: string) {
    super(`Action "${actionName}" is already registered by plugin "${ownerPluginId}"`);
    this.name = 'ActionDuplicateError';
    this.actionName = actionName;
    this.ownerPluginId = ownerPluginId;
  }
}

/** Raised when an action name is not present in the registry. */
export class ActionNotFoundError extends ActionManagerError {
  public readonly code = 'ACTION_NOT_FOUND' as const;

  /** Name that could not be resolved. */
  public readonly actionName: string;

  /**
   * @param actionName - Name that could not be resolved.
   */
  constructor(actionName: string) {
    super(`Action "${actionName}" is not registered`);
    this.name = 'ActionNotFoundError';
    this.actionName = actionName;
  }
}

/**
 * Raised when an action definition is rejected before it enters the registry.
 *
 * Registration validates the caller-provided schema up front: it must be plain
 * JSON (no cycles or non-JSON values) and must compile under the same subset
 * compiler dispatch uses. Rejecting at registration keeps an unusable action
 * out of the UI catalog instead of failing later at execution.
 */
export class ActionRegistrationError extends ActionManagerError {
  public readonly code = 'ACTION_REGISTRATION_ERROR' as const;

  /** Name of the action whose registration was rejected. */
  public readonly actionName: string;

  /** Stable sub-code naming the rejected schema property. */
  public readonly reasonCode: string;

  /**
   * @param actionName - Action whose registration was rejected.
   * @param reasonCode - Stable sub-code such as `SCHEMA_CIRCULAR`.
   * @param message - Human-readable failure description.
   */
  constructor(actionName: string, reasonCode: string, message: string) {
    super(message);
    this.name = 'ActionRegistrationError';
    this.actionName = actionName;
    this.reasonCode = reasonCode;
  }
}

/** Raised when a plugin tries to exceed its action registration quota. */
export class ActionQuotaExceededError extends ActionManagerError {
  public readonly code = 'ACTION_QUOTA_EXCEEDED' as const;

  /** Plugin that hit the quota. */
  public readonly pluginId: string;

  /** Maximum number of actions the plugin may own. */
  public readonly limit: number;

  /**
   * @param pluginId - Plugin that hit the quota.
   * @param limit - Maximum number of actions the plugin may own.
   */
  constructor(pluginId: string, limit: number) {
    super(`Plugin "${pluginId}" exceeded the action registration quota of ${String(limit)}`);
    this.name = 'ActionQuotaExceededError';
    this.pluginId = pluginId;
    this.limit = limit;
  }
}

/** Raised when a payload fails the declared JSON Schema gate. */
export class ActionValidationError extends ActionManagerError {
  public readonly code = 'ACTION_VALIDATION_ERROR' as const;

  /** Name of the action whose payload was rejected. */
  public readonly actionName: string;

  /**
   * @param actionName - Action whose payload was rejected.
   * @param reason - Human-readable explanation.
   */
  constructor(actionName: string, reason: string) {
    super(`Action "${actionName}" input rejected: ${reason}`);
    this.name = 'ActionValidationError';
    this.actionName = actionName;
  }
}

/** Raised when the registry is used after it was cleared by disposal. */
export class ActionDisposedError extends ActionManagerError {
  public readonly code = 'ACTION_DISPOSED' as const;

  constructor() {
    super('Action registry has been disposed');
    this.name = 'ActionDisposedError';
  }
}

/** Builds the `failed` envelope text for an action failure. */
export function actionFailureMessage(error: ActionManagerError): string {
  return `${error.code}: ${error.message}`;
}