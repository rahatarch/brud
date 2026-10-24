export class FileAlreadyExistsError extends Error {
  public readonly code = 'FILE_ALREADY_EXISTS' as const;

  public readonly path: string;

  constructor(path: string) {
    super(`File already exists: "${path}"`);
    this.name = 'FileAlreadyExistsError';
    this.path = path;
  }
}

export function hasErrorCode(error: unknown, code: string): boolean {
  if (!(error instanceof Error) || !('code' in error)) {
    return false;
  }

  const value: unknown = error.code;
  return value === code;
}
