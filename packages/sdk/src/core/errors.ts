/** Stable codes of errors the SDK raises itself (kernel errors pass through unchanged). */
export type SdkErrorCode =
  | 'SDK_DEFINITION_INVALID'
  | 'SDK_INSTANCE_NOT_READY'
  | 'SDK_NOT_PLAIN';

/** An error raised by the SDK, with a stable `code`. */
export class SdkError extends Error {
  public readonly code: SdkErrorCode;

  constructor(code: SdkErrorCode, message: string) {
    super(message);
    this.name = 'SdkError';
    this.code = code;
  }
}
