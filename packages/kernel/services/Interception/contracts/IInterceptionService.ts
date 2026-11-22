import type { ExposedApiCaller } from '../../ExposedApiRegistry/contracts/types.js';

/** The plain caller view an interceptor sees. */
export interface InterceptedCaller {
  readonly identity: string | null;
  readonly callerClass: string;
  readonly official: boolean;
  readonly capabilities: ReadonlySet<string>;
  readonly origin: string;
}

/** The plain, frozen record of one intercepted call. */
export interface InterceptedCall {
  /** The interception point, `name@major`. */
  readonly target: string;
  /** The method of the target exposure being called. */
  readonly method: string;
  /** The call's arguments (plain JSON values). */
  readonly args: readonly unknown[];
  /** The original caller of the giver's exposure. */
  readonly caller: InterceptedCaller;
}

/**
 * An interceptor's verdict. `modify` replaces the call's arguments (same method,
 * same target); it cannot re-route the call.
 */
export type InterceptionVerdict =
  | { readonly verdict: 'allow' }
  | { readonly verdict: 'block'; readonly reason: string }
  | { readonly verdict: 'modify'; readonly args: readonly unknown[] };

/**
 * What a giver implements on its instance to be called by the interception
 * hardcore. A non-enumerable method, like `provideExposure`: it is reached only
 * through the hardcore (`instanceOf` + `runAs`), never through `resolve`.
 */
export interface IInterceptor {
  intercept(call: InterceptedCall): InterceptionVerdict;
}

/** A stage of interception. */
export type InterceptionStage = 'input' | 'output';

/**
 * Largest values the output stage allows, in bytes of canonical JSON. A point
 * may lower any of them with `outputLimits` and can never raise one.
 */
export const INTERCEPTION_OUTPUT_CEILINGS = Object.freeze({
  /** A giver's result, as shown to interceptors. */
  maxResultBytes: 1_048_576,
  /** The content of one interceptor's addition. */
  maxAdditionBytes: 65_536,
  /** All additions to one result together. */
  maxTotalBytes: 262_144,
});

/** The intercepted call and the giver's result: plain, deep-frozen JSON. */
export interface InterceptedResult extends InterceptedCall {
  /** What the giver returned. */
  readonly result: unknown;
}

/**
 * An output-stage verdict. An interceptor can only add: there is no way to
 * change, replace or remove the result, or to withhold it.
 */
export type InterceptionOutputVerdict =
  | { readonly verdict: 'none' }
  | { readonly verdict: 'append'; readonly content: unknown };

/**
 * What an interceptor implements on its instance to take part in the output
 * stage (non-enumerable, like `intercept`): reached only through the hardcore.
 */
export interface IResultInterceptor {
  interceptResult(call: InterceptedResult): InterceptionOutputVerdict;
}

/** One piece of content an interceptor appended, attributed to it. */
export interface InterceptionAddition {
  /** Service token of the interceptor that appended it. */
  readonly interceptor: string;
  /** The appended plain JSON content. */
  readonly content: unknown;
}

/**
 * What a caller of an intercepted exposure receives: the giver's result
 * exactly as returned, the additions in the order the interceptors ran, and
 * the interceptors that ran.
 */
export interface InterceptionEnvelope {
  readonly result: unknown;
  readonly additions: readonly InterceptionAddition[];
  readonly interceptedBy: readonly string[];
}

/**
 * The outcome of the output stage. `applied: false` means no admitted
 * interceptor takes part in it, so the giver returns its result as it always
 * did. `allowed: false` withholds the result.
 */
export type InterceptionResultOutcome =
  | { readonly applied: false }
  | { readonly applied: true; readonly allowed: true; readonly envelope: InterceptionEnvelope }
  | { readonly applied: true; readonly allowed: false; readonly reason: string; readonly interceptor?: string };

/** Options the giver passes to `evaluate`. */
export interface InterceptionEvaluateOptions {
  /** The caller view the giver's projection received (delegation by the owner). */
  readonly caller?: ExposedApiCaller;
}

/** The combined outcome the giver enforces. */
export type InterceptionOutcome =
  | { readonly allowed: true; readonly args: readonly unknown[]; readonly modifiedBy: readonly string[] }
  | { readonly allowed: false; readonly reason: string; readonly interceptor?: string };

export interface IInterceptionService {
  /**
   * Runs the admitted interceptors of the giver's interception point, in the
   * giver's order. Only the point's owner may evaluate it.
   */
  evaluate(
    target: string,
    method: string,
    args: readonly unknown[],
    options?: InterceptionEvaluateOptions,
  ): InterceptionOutcome;
  /**
   * Runs the output stage of the giver's interception point on the result the
   * giver produced: each interceptor that declared the output stage may append
   * content, in the giver's order. The result is never changed. Only the
   * point's owner may evaluate it, and `args` are the final arguments of the
   * call (after any input modification). The result must be plain JSON.
   */
  evaluateResult(
    target: string,
    method: string,
    args: readonly unknown[],
    result: unknown,
    options?: InterceptionEvaluateOptions,
  ): InterceptionResultOutcome;
  /** The interception points in this composition, as `name@major`. */
  list(): readonly string[];
}
