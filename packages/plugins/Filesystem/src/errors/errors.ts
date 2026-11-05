/**
 * Plugin-local error taxonomy.
 *
 * Kernel failures are translated by duck typing (`code` and `rule`) so the
 * plugin never imports kernel runtime classes and never bypasses the kernel
 * filesystem. The mapping is intentionally narrow: only codes a caller can act
 * on are surfaced.
 */

export type FilesystemErrorCode =
  | 'FILE_NOT_FOUND'
  | 'PARENT_NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_ERROR'
  | 'PROTECTED_PATH_DENIED'
  | 'WORKSPACE_PATH_VIOLATION'
  | 'BATCH_LIMIT_EXCEEDED'
  | 'SEARCH_FAILED'
  | 'HISTORY_FAILED'
  | 'CANNOT_DELETE_FILE_AS_DIRECTORY'
  | 'EXECUTION_FAILED'
  | 'SEARCH_NOT_FOUND'
  | 'MULTIPLE_MATCHES'
  | 'DIRECTORY_NOT_FOUND'
  | 'DIRECTORY_ALREADY_EXISTS';

export interface FilesystemErrorOptions {
  readonly path?: string;
  readonly cause?: unknown;
}

/** Typed failure raised by the Filesystem plugin. */
export class FilesystemError extends Error {
  public readonly code: FilesystemErrorCode;

  public readonly path: string | undefined;

  constructor(
    code: FilesystemErrorCode,
    path: string | undefined,
    message: string,
    options: FilesystemErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'FilesystemError';
    this.code = code;
    this.path = path;
  }
}

export function isFilesystemError(value: unknown): value is FilesystemError {
  return value instanceof FilesystemError;
}

function stringProperty(value: unknown, property: string): string | undefined {
  if (typeof value !== 'object' || value === null || !(property in value)) {
    return undefined;
  }

  const candidate = (value as Record<string, unknown>)[property];

  return typeof candidate === 'string' ? candidate : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Raw OS errno codes mapped onto the plugin taxonomy. */
const ERRNO_CODES: Readonly<Record<string, FilesystemErrorCode>> = Object.freeze({
  ENOENT: 'FILE_NOT_FOUND',
  EEXIST: 'CONFLICT',
  ENOTDIR: 'CONFLICT',
  EACCES: 'VALIDATION_ERROR',
  EPERM: 'VALIDATION_ERROR',
  EXDEV: 'EXECUTION_FAILED',
});

/** Kernel filesystem error codes mapped onto the plugin taxonomy. */
const KERNEL_CODES: Readonly<Record<string, FilesystemErrorCode>> = Object.freeze({
  FILE_ALREADY_EXISTS: 'CONFLICT',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  PARENT_NOT_FOUND: 'PARENT_NOT_FOUND',
  CONFLICT: 'CONFLICT',
  CANNOT_DELETE_FILE_AS_DIRECTORY: 'CANNOT_DELETE_FILE_AS_DIRECTORY',
  CANNOT_WRITE_DIRECTORY: 'VALIDATION_ERROR',
  CANNOT_DELETE_DIRECTORY: 'VALIDATION_ERROR',
  STAGING_CONFLICT: 'CONFLICT',
  UNSUPPORTED: 'EXECUTION_FAILED',
  EACCES: 'VALIDATION_ERROR',
  PATH_TRAVERSAL_DETECTED: 'WORKSPACE_PATH_VIOLATION',
  WORKSPACE_PATH_VIOLATION: 'WORKSPACE_PATH_VIOLATION',
  READ_ONLY_VIOLATION: 'VALIDATION_ERROR',
  READ_ONLY_PROJECTION: 'VALIDATION_ERROR',
});

const PROTECTED_RULES = new Set([
  'PROTECTED_PATH_DENIED',
  'PATH.PROTECTED_DENY',
  'PATH.ROOT_NOT_MUTABLE',
]);

/** Maps a raw errno-shaped failure to the taxonomy. */
export function mapOsError(error: unknown, path?: string): FilesystemError {
  const code = stringProperty(error, 'code');
  const mapped = code === undefined ? undefined : ERRNO_CODES[code];

  return new FilesystemError(
    mapped ?? 'EXECUTION_FAILED',
    path,
    messageOf(error),
    { cause: error },
  );
}

/**
 * Converts any thrown value into a typed {@link FilesystemError}.
 *
 * Kernel `WorkspaceViolationError` carries a stable `rule`; protected-path
 * denials are surfaced as `PROTECTED_PATH_DENIED`, every other containment
 * failure as `WORKSPACE_PATH_VIOLATION`.
 */
export function toFilesystemError(error: unknown, path?: string): FilesystemError {
  if (error instanceof FilesystemError) {
    return error;
  }

  const code = stringProperty(error, 'code');
  const rule = stringProperty(error, 'rule');
  const message = messageOf(error);

  if (code === 'WORKSPACE_PATH_VIOLATION' || code === 'PATH_TRAVERSAL_DETECTED') {
    if (rule !== undefined && PROTECTED_RULES.has(rule)) {
      return new FilesystemError('PROTECTED_PATH_DENIED', path, message, { cause: error });
    }

    return new FilesystemError('WORKSPACE_PATH_VIOLATION', path, message, { cause: error });
  }

  if (rule !== undefined && PROTECTED_RULES.has(rule)) {
    return new FilesystemError('PROTECTED_PATH_DENIED', path, message, { cause: error });
  }

  if (code !== undefined && KERNEL_CODES[code] !== undefined) {
    return new FilesystemError(KERNEL_CODES[code], path, message, { cause: error });
  }

  if (code !== undefined && ERRNO_CODES[code] !== undefined) {
    return new FilesystemError(ERRNO_CODES[code], path, message, { cause: error });
  }

  return new FilesystemError('EXECUTION_FAILED', path, message, { cause: error });
}