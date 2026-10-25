export class FileAlreadyExistsError extends Error {
  public readonly code = 'FILE_ALREADY_EXISTS' as const;

  public readonly path: string;

  constructor(path: string) {
    super(`File already exists: "${path}"`);
    this.name = 'FileAlreadyExistsError';
    this.path = path;
  }
}

/** Stable classifications for filesystem domain failures. */
export type FileSystemErrorCode =
  | 'CANNOT_WRITE_DIRECTORY'
  | 'CANNOT_DELETE_DIRECTORY'
  | 'STAGING_CONFLICT';

/** Typed filesystem failure that is not a path or workspace violation. */
export class FileSystemError extends Error {
  public readonly code: FileSystemErrorCode;

  public readonly path: string;

  constructor(code: FileSystemErrorCode, path: string, message: string) {
    super(message);
    this.name = 'FileSystemError';
    this.code = code;
    this.path = path;
  }
}

/**
 * Raised when a rename/link committed the mutation but the directory flush
 * failed afterwards.
 *
 * `committed` is always `true`: callers must treat the file as updated on
 * disk even though durability of the directory entry is unconfirmed.
 */
export class CommittedWithDurabilityWarningError extends Error {
  public readonly code = 'COMMITTED_WITH_DURABILITY_WARNING' as const;

  public readonly committed = true as const;

  public readonly path: string;

  /** Failure raised by the directory `fsync` (or equivalent). */
  public readonly fsyncError: unknown;

  constructor(path: string, fsyncError: unknown) {
    super(
      `Mutation committed to "${path}" but the directory flush failed: ${
        fsyncError instanceof Error ? fsyncError.message : String(fsyncError)
      }`,
    );
    this.name = 'CommittedWithDurabilityWarningError';
    this.path = path;
    this.fsyncError = fsyncError;
    this.cause = fsyncError;
  }
}

export function hasErrorCode(error: unknown, code: string): boolean {
  if (!(error instanceof Error) || !('code' in error)) {
    return false;
  }

  const value: unknown = error.code;
  return value === code;
}
