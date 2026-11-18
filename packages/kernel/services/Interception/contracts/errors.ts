/** Stable, machine-readable codes for interception failures. */
export type InterceptionErrorCode =
  | 'INTERCEPTION_DECLARATION_INVALID'
  | 'INTERCEPTION_BLOCKED';

/** Base class for every interception domain failure. */
export abstract class InterceptionError extends Error {
  /** Stable, machine-readable error code. */
  public abstract readonly code: InterceptionErrorCode;

  protected constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'InterceptionError';
  }
}

/** Raised at boot when an interception or an interception point is not admissible. */
export class InterceptionDeclarationError extends InterceptionError {
  public readonly code = 'INTERCEPTION_DECLARATION_INVALID' as const;

  /** Service token of the declaring participant. */
  public readonly participant: string;

  constructor(participant: string, reason: string) {
    super(`Participant "${participant}": ${reason}`);
    this.name = 'InterceptionDeclarationError';
    this.participant = participant;
  }
}

/** Thrown by a giver when the interception outcome blocks the call. */
export class InterceptionBlockedError extends InterceptionError {
  public readonly code = 'INTERCEPTION_BLOCKED' as const;

  /** The interception point, `name@major`. */
  public readonly target: string;

  /** The blocking reason. */
  public readonly reason: string;

  /** Service token of the blocking interceptor, when one blocked. */
  public readonly interceptor: string | undefined;

  constructor(target: string, reason: string, interceptor?: string) {
    super(`Call to "${target}" was blocked by interception: ${reason}`);
    this.name = 'InterceptionBlockedError';
    this.target = target;
    this.reason = reason;
    this.interceptor = interceptor;
  }
}
