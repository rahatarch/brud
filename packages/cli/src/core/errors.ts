/** A command that failed in a way worth a message, not a stack (exit code 1). */
export class CommandError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = 'CommandError';
    this.code = code;
  }
}

/** The code and message of anything thrown, for reports. */
export function describeError(error: unknown): { readonly code: string | undefined; readonly message: string } {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;

    return { code: typeof code === 'string' ? code : undefined, message: error.message };
  }

  return { code: undefined, message: String(error) };
}
