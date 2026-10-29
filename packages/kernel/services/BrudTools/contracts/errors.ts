/** Stable, machine-readable codes for BrudTools domain failures. */
export type BrudToolsErrorCode =
  | 'TOOL_DUPLICATE'
  | 'TOOL_NOT_FOUND'
  | 'TOOL_VALIDATION_ERROR'
  | 'TOOL_DISPOSED';

/**
 * Base class for every BrudTools domain failure.
 *
 * Subclasses carry a stable {@link BrudToolsErrorCode} so hosts can branch on
 * failures without parsing human-readable messages.
 */
export abstract class BrudToolsError extends Error {
  /** Stable, machine-readable error code. */
  public abstract readonly code: BrudToolsErrorCode;

  /**
   * @param message - Human-readable failure description.
   * @param options - Optional native error options, including `cause`.
   */
  protected constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BrudToolsError';
  }
}

/** Raised when a tool name is registered more than once. */
export class ToolDuplicateError extends BrudToolsError {
  public readonly code = 'TOOL_DUPLICATE' as const;

  /** Name that was registered twice. */
  public readonly toolName: string;

  /** Plugin that already owns the name. */
  public readonly ownerPluginId: string;

  /**
   * @param toolName - Duplicated tool name.
   * @param ownerPluginId - Plugin that already owns the name.
   */
  constructor(toolName: string, ownerPluginId: string) {
    super(`Tool "${toolName}" is already registered by plugin "${ownerPluginId}"`);
    this.name = 'ToolDuplicateError';
    this.toolName = toolName;
    this.ownerPluginId = ownerPluginId;
  }
}

/** Raised when a tool name is not present in the registry. */
export class ToolNotFoundError extends BrudToolsError {
  public readonly code = 'TOOL_NOT_FOUND' as const;

  /** Name that could not be resolved. */
  public readonly toolName: string;

  /**
   * @param toolName - Name that could not be resolved.
   */
  constructor(toolName: string) {
    super(`Tool "${toolName}" is not registered`);
    this.name = 'ToolNotFoundError';
    this.toolName = toolName;
  }
}

/** Raised when a payload fails the declared JSON Schema gate. */
export class ToolValidationError extends BrudToolsError {
  public readonly code = 'TOOL_VALIDATION_ERROR' as const;

  /** Name of the tool whose payload was rejected. */
  public readonly toolName: string;

  /** Validator code, when the gate supplied one. */
  public readonly validationCode?: string;

  /**
   * @param toolName - Tool whose payload was rejected.
   * @param reason - Human-readable explanation.
   * @param options - Optional validator code and cause.
   */
  constructor(
    toolName: string,
    reason: string,
    options?: { readonly validationCode?: string; readonly cause?: unknown },
  ) {
    super(`Tool "${toolName}" input rejected: ${reason}`, { cause: options?.cause });
    this.name = 'ToolValidationError';
    this.toolName = toolName;

    if (options?.validationCode !== undefined) {
      this.validationCode = options.validationCode;
    }
  }
}

/** Raised when the registry is used after it was cleared by disposal. */
export class ToolDisposedError extends BrudToolsError {
  public readonly code = 'TOOL_DISPOSED' as const;

  constructor() {
    super('Tool registry has been disposed');
    this.name = 'ToolDisposedError';
  }
}

/** Builds the `failed` envelope text for a tool failure. */
export function toolFailureMessage(error: BrudToolsError): string {
  return `${error.code}: ${error.message}`;
}
