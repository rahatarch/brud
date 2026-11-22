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
  /** The interception points in this composition, as `name@major`. */
  list(): readonly string[];
}
