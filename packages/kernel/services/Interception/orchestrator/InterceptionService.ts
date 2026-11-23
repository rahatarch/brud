import { createCapabilitySet } from '../../../src/contracts/capabilitySet.js';
import type {
  AdmittedManifest,
  KernelCallAuthority,
} from '../../../src/contracts/index.js';
import { compileJsonSchema } from '../../../src/validation/jsonSchema/index.js';
import { freezeJsonCopy, inspectJsonValue } from '../../../src/validation/jsonSchema/jsonValue.js';
import type { ExposedApiCaller } from '../../ExposedApiRegistry/contracts/types.js';
import { InterceptionDeclarationError } from '../contracts/errors.js';
import {
  INTERCEPTION_OUTPUT_CEILINGS,
  type IInterceptionService,
  type IInterceptor,
  type InterceptedCall,
  type InterceptedResult,
  type InterceptionAddition,
  type InterceptionSkipped,
  type InterceptionEvaluateOptions,
  type InterceptionOutcome,
  type InterceptionOutputVerdict,
  type InterceptionResultOutcome,
  type InterceptionStage,
  type InterceptionVerdict,
  type IResultInterceptor,
} from '../contracts/IInterceptionService.js';

/** Source name the interception hardcore records observations under. */
const OBSERVATION_SOURCE = 'brud.core.interception';

/** Arguments must be a plain JSON array within the kernel validator's limits. */
const ARGS_SCHEMA = ((): { validate(value: unknown): { readonly valid: boolean } } => {
  const compiled = compileJsonSchema({ type: 'array' });

  if (!compiled.ok) {
    throw new Error('interception argument schema failed to compile');
  }

  return compiled.schema;
})();

/** One participant of the composition, as the boot hook hands it over. */
export interface InterceptionParticipant {
  readonly token: string;
  readonly identity: string | undefined;
  readonly manifest: AdmittedManifest;
}

/** One admitted interceptor of a point. */
interface AdmittedInterceptor {
  readonly token: string;
  readonly identity: string;
  /** The stages it declared; `output` unless it said otherwise. */
  readonly stages: readonly InterceptionStage[];
}

/** The output-stage limits in force at one point, in bytes of canonical JSON. */
interface OutputLimits {
  readonly maxResultBytes: number;
  readonly maxAdditionBytes: number;
  readonly maxTotalBytes: number;
}

/** One interception point: a giver's exposure and its ordered interceptors. */
interface InterceptionPoint {
  readonly key: string;
  readonly owner: string;
  readonly interceptors: readonly AdmittedInterceptor[];
  readonly limits: OutputLimits;
}

function majorOf(version: number | string | undefined): number {
  if (version === undefined) {
    return 1;
  }

  return typeof version === 'number' ? version : Number.parseInt(version.split('.')[0] ?? '', 10);
}

function pointKey(name: string, version: number | string | undefined): string {
  return `${name}@${String(majorOf(version))}`;
}

function isInterceptor(value: unknown): value is IInterceptor {
  return typeof (value as { intercept?: unknown } | null)?.intercept === 'function';
}

function isResultInterceptor(value: unknown): value is IResultInterceptor {
  return typeof (value as { interceptResult?: unknown } | null)?.interceptResult === 'function';
}

/** Largest value shape the output stage will carry: plain JSON of ordinary size. */
const OUTPUT_JSON_LIMITS = Object.freeze({ maxDepth: 64, maxNodes: 100_000 });

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

/**
 * Reads a point's `outputLimits`: any of the three limits may be lowered,
 * none may be raised above its kernel ceiling, and one addition may not be
 * allowed to exceed all additions together.
 */
function parseOutputLimits(owner: string, key: string, declared: Readonly<Record<string, number>> | undefined): OutputLimits {
  const limits: Record<keyof OutputLimits, number> = { ...INTERCEPTION_OUTPUT_CEILINGS };

  for (const [name, value] of Object.entries(declared ?? {})) {
    if (!(name in INTERCEPTION_OUTPUT_CEILINGS)) {
      throw new InterceptionDeclarationError(owner, `outputLimits of "${key}" has an unknown limit "${name}"`);
    }

    const ceiling = INTERCEPTION_OUTPUT_CEILINGS[name as keyof OutputLimits];

    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > ceiling) {
      throw new InterceptionDeclarationError(owner, `outputLimits.${name} of "${key}" must be a whole number from 1 to ${String(ceiling)}`);
    }

    limits[name as keyof OutputLimits] = value;
  }

  if (limits.maxAdditionBytes > limits.maxTotalBytes) {
    throw new InterceptionDeclarationError(owner, `outputLimits of "${key}" allow one addition to exceed all additions together`);
  }

  return Object.freeze(limits);
}

function isValidArgs(value: unknown): value is readonly unknown[] {
  return Array.isArray(value) && ARGS_SCHEMA.validate(value).valid;
}

export class InterceptionService implements IInterceptionService {
  private authority: KernelCallAuthority | undefined;

  readonly #points = new Map<string, InterceptionPoint>();

  public bindAuthority(value: KernelCallAuthority): void {
    this.authority = value;
  }

  /**
   * Builds the interception-point table from the composition's manifests.
   *
   * A point must sit on an exposure its giver declares; every admitted token
   * must be a participant that declares an interception of that point; every
   * declared interception must be admitted by a point. Anything else refuses
   * the boot.
   */
  public registerComposition(participants: readonly InterceptionParticipant[]): void {
    const byToken = new Map(participants.map((participant) => [participant.token, participant]));
    const requests = new Map<string, Set<string>>();

    for (const participant of participants) {
      for (const interception of participant.manifest.interceptions) {
        const key = pointKey(interception.target, interception.version);
        const tokens = requests.get(key) ?? new Set<string>();

        tokens.add(participant.token);
        requests.set(key, tokens);
      }
    }

    for (const participant of participants) {
      if (participant.manifest.interceptionPoints.length === 0) {
        continue;
      }

      const owner = participant.identity;

      if (owner === undefined) {
        throw new InterceptionDeclarationError(participant.token, 'declares interception points but has no kernel identity');
      }

      for (const point of participant.manifest.interceptionPoints) {
        const key = pointKey(point.exposure, point.version);
        const gives = participant.manifest.exposures.some((exposure) =>
          pointKey(exposure.name, exposure.version) === key);

        if (!gives) {
          throw new InterceptionDeclarationError(participant.token, `opens an interception point on "${key}", which it does not expose`);
        }

        if (this.#points.has(key)) {
          throw new InterceptionDeclarationError(participant.token, `interception point "${key}" is declared twice`);
        }

        const interceptors = point.admit.map((token): AdmittedInterceptor => {
          const interceptor = byToken.get(token);

          if (interceptor === undefined) {
            throw new InterceptionDeclarationError(participant.token, `admits "${token}", which is not in the composition`);
          }

          if (token === participant.token) {
            throw new InterceptionDeclarationError(participant.token, `cannot admit itself on "${key}"`);
          }

          if (requests.get(key)?.has(token) !== true) {
            throw new InterceptionDeclarationError(participant.token, `admits "${token}", which declares no interception of "${key}"`);
          }

          if (interceptor.identity === undefined) {
            throw new InterceptionDeclarationError(token, 'is admitted as an interceptor but has no kernel identity');
          }

          const declared = interceptor.manifest.interceptions.find((entry) => pointKey(entry.target, entry.version) === key);

          return Object.freeze({ token, identity: interceptor.identity, stages: Object.freeze([...(declared?.stages ?? ['output'])]) });
        });

        this.#points.set(key, Object.freeze({
          key,
          owner,
          interceptors: Object.freeze(interceptors),
          limits: parseOutputLimits(participant.token, key, point.outputLimits),
        }));
      }
    }

    for (const [key, tokens] of requests) {
      for (const token of tokens) {
        if (this.#points.get(key)?.interceptors.some((interceptor) => interceptor.token === token) !== true) {
          throw new InterceptionDeclarationError(token, `declares an interception of "${key}" that no giver admits`);
        }
      }
    }
  }

  public evaluate(
    target: string,
    method: string,
    args: readonly unknown[],
    options?: InterceptionEvaluateOptions,
  ): InterceptionOutcome {
    const context = this.authority?.current();
    const caller = context === undefined ? undefined : { ...context.caller, origin: context.origin };

    return this.evaluateAs(caller, target, method, args, options);
  }

  public list(): readonly string[] {
    return Array.from(this.#points.keys());
  }

  /**
   * Evaluates the point for `resolver`, which must be the point's owner. The
   * interceptors run in the giver's admitted order, each as itself: the first
   * `block` wins; `modify` chains; a throw or an invalid verdict blocks
   * (fail closed).
   */
  public evaluateAs(
    resolver: ExposedApiCaller | undefined,
    target: string,
    method: string,
    args: readonly unknown[],
    options?: InterceptionEvaluateOptions,
  ): InterceptionOutcome {
    const key = target.includes('@') ? target : `${target}@1`;
    const point = this.#points.get(key);
    const authority = this.authority;

    if (authority === undefined) {
      return this.#refuse(key, 'interception is not bound');
    }

    if (point === undefined) {
      return this.#refuse(key, 'unknown interception point');
    }

    if (resolver?.identity === null || resolver?.identity === undefined || resolver.identity !== point.owner) {
      return this.#refuse(key, 'only the interception point owner may evaluate it');
    }

    if (typeof method !== 'string' || method.length === 0 || !isValidArgs(args)) {
      return this.#refuse(key, 'method must be a non-empty string and args a plain JSON array');
    }

    const caller = options?.caller ?? resolver;
    let call: InterceptedCall = Object.freeze({
      target: key,
      method,
      args: freezeJsonCopy(args),
      caller: Object.freeze({
        identity: caller.identity,
        callerClass: caller.callerClass,
        official: caller.official,
        // The giver names the caller it is intercepting for; whatever it passes, the interceptor sees the one read-only shape.
        capabilities: createCapabilitySet(caller.capabilities ?? []),
        origin: caller.origin,
      }),
    });
    const modifiedBy: string[] = [];

    for (const interceptor of point.interceptors) {
      if (!interceptor.stages.includes('input')) {
        continue;
      }

      let verdict: InterceptionVerdict;

      try {
        const instance = authority.instanceOf(interceptor.identity);

        if (!isInterceptor(instance)) {
          throw new Error('the interceptor does not implement intercept');
        }

        const current = call;

        verdict = authority.runAs(interceptor.identity, () => instance.intercept(current));
      } catch (error) {
        return this.#fail(key, interceptor.token, error instanceof Error ? error.message : 'interceptor threw');
      }

      if (verdict?.verdict === 'allow') {
        continue;
      }

      if (verdict?.verdict === 'block' && typeof verdict.reason === 'string') {
        authority.observe(OBSERVATION_SOURCE, 'interception.blocked', { target: key, method, interceptor: interceptor.token, reason: verdict.reason });

        return Object.freeze({ allowed: false, reason: verdict.reason, interceptor: interceptor.token });
      }

      if (verdict?.verdict === 'modify' && isValidArgs(verdict.args)) {
        call = Object.freeze({ ...call, args: freezeJsonCopy(verdict.args) });
        modifiedBy.push(interceptor.token);
        authority.observe(OBSERVATION_SOURCE, 'interception.modified', { target: key, method, interceptor: interceptor.token });
        continue;
      }

      return this.#fail(key, interceptor.token, 'invalid verdict');
    }

    return Object.freeze({ allowed: true, args: call.args, modifiedBy: Object.freeze(modifiedBy) });
  }

  public evaluateResult(
    target: string,
    method: string,
    args: readonly unknown[],
    result: unknown,
    options?: InterceptionEvaluateOptions,
  ): InterceptionResultOutcome {
    const context = this.authority?.current();
    const caller = context === undefined ? undefined : { ...context.caller, origin: context.origin };

    return this.evaluateResultAs(caller, target, method, args, result, options);
  }

  /**
   * Runs the output stage for `resolver`, which must be the point's owner. The
   * interceptors that declared the stage run in the giver's admitted order,
   * each as itself and each seeing only the original result; each may append
   * one piece of content and nothing else. Any failure withholds the result.
   */
  public evaluateResultAs(
    resolver: ExposedApiCaller | undefined,
    target: string,
    method: string,
    args: readonly unknown[],
    result: unknown,
    options?: InterceptionEvaluateOptions,
  ): InterceptionResultOutcome {
    const key = target.includes('@') ? target : `${target}@1`;
    const point = this.#points.get(key);
    const authority = this.authority;

    if (authority === undefined) {
      return this.#refuseResult(key, 'interception is not bound');
    }

    if (point === undefined) {
      return this.#refuseResult(key, 'unknown interception point');
    }

    if (resolver?.identity === null || resolver?.identity === undefined || resolver.identity !== point.owner) {
      return this.#refuseResult(key, 'only the interception point owner may evaluate it');
    }

    const taking = point.interceptors.filter((interceptor) => interceptor.stages.includes('output'));

    if (taking.length === 0) {
      return Object.freeze({ applied: false });
    }

    if (typeof method !== 'string' || method.length === 0 || !isValidArgs(args)) {
      return this.#refuseResult(key, 'method must be a non-empty string and args a plain JSON array');
    }

    // A result the output stage cannot carry is the giver's own data, never an
    // interceptor's doing. The stage is skipped and the giver ships its result.
    if (inspectJsonValue(result, OUTPUT_JSON_LIMITS) !== null) {
      return this.#skipStage(key, 'the result must be plain JSON to take part in the output stage');
    }

    const resultBytes = result === undefined ? 0 : jsonBytes(result);

    if (resultBytes > point.limits.maxResultBytes) {
      return this.#skipStage(key, `the result is ${String(resultBytes)} bytes; the limit is ${String(point.limits.maxResultBytes)}`);
    }

    const caller = options?.caller ?? resolver;
    const frozenResult = freezeJsonCopy(result);
    const call: InterceptedResult = Object.freeze({
      target: key,
      method,
      args: freezeJsonCopy(args),
      caller: Object.freeze({
        identity: caller.identity,
        callerClass: caller.callerClass,
        official: caller.official,
        capabilities: createCapabilitySet(caller.capabilities ?? []),
        origin: caller.origin,
      }),
      result: frozenResult,
    });
    const additions: InterceptionAddition[] = [];
    const ran: string[] = [];
    const skipped: InterceptionSkipped[] = [];
    let total = 0;

    // The output stage can only append, so an interceptor that misbehaves is
    // skipped and the result is delivered without its contribution. It must
    // never be able to withhold the giver's result by failing.
    for (const interceptor of taking) {
      const skip = (reason: string): void => {
        skipped.push(Object.freeze({ interceptor: interceptor.token, reason }));
        authority.observe(OBSERVATION_SOURCE, 'interception.result.skipped', { target: key, method, interceptor: interceptor.token, reason });
      };
      let verdict: InterceptionOutputVerdict;

      try {
        const instance = authority.instanceOf(interceptor.identity);

        if (!isResultInterceptor(instance)) {
          throw new Error('the interceptor does not implement interceptResult (an interceptor that means to see arguments must declare the input stage)');
        }

        verdict = authority.runAs(interceptor.identity, () => instance.interceptResult(call));
      } catch (error) {
        skip(error instanceof Error ? error.message : 'interceptor threw');
        continue;
      }

      if (verdict?.verdict === 'none') {
        ran.push(interceptor.token);
        authority.observe(OBSERVATION_SOURCE, 'interception.result.unchanged', { target: key, method, interceptor: interceptor.token });
        continue;
      }

      if (verdict?.verdict !== 'append' || inspectJsonValue(verdict.content, OUTPUT_JSON_LIMITS) !== null || verdict.content === undefined) {
        skip('invalid output verdict: the output stage can only append');
        continue;
      }

      const bytes = jsonBytes(verdict.content);

      if (bytes > point.limits.maxAdditionBytes) {
        skip(`the addition is ${String(bytes)} bytes; the limit is ${String(point.limits.maxAdditionBytes)}`);
        continue;
      }

      if (total + bytes > point.limits.maxTotalBytes) {
        skip(`the additions together would exceed ${String(point.limits.maxTotalBytes)} bytes`);
        continue;
      }

      total += bytes;
      ran.push(interceptor.token);
      additions.push(Object.freeze({ interceptor: interceptor.token, content: freezeJsonCopy(verdict.content) }));
      authority.observe(OBSERVATION_SOURCE, 'interception.result.appended', { target: key, method, interceptor: interceptor.token, bytes });
    }

    return Object.freeze({
      applied: true,
      allowed: true,
      envelope: Object.freeze({
        result: frozenResult,
        additions: Object.freeze(additions),
        interceptedBy: Object.freeze(ran),
        skipped: Object.freeze(skipped),
      }),
    });
  }

  #refuseResult(key: string, reason: string): InterceptionResultOutcome {
    this.authority?.observe(OBSERVATION_SOURCE, 'interception.result.refused', { target: key, reason });

    return Object.freeze({ applied: true, allowed: false, reason });
  }

  #skipStage(key: string, reason: string): InterceptionResultOutcome {
    this.authority?.observe(OBSERVATION_SOURCE, 'interception.result.stage-skipped', { target: key, reason });

    return Object.freeze({ applied: false });
  }

  #refuse(key: string, reason: string): InterceptionOutcome {
    this.authority?.observe(OBSERVATION_SOURCE, 'interception.refused', { target: key, reason });

    return Object.freeze({ allowed: false, reason });
  }

  #fail(key: string, interceptor: string, reason: string): InterceptionOutcome {
    this.authority?.observe(OBSERVATION_SOURCE, 'interception.failed', { target: key, interceptor, reason });

    return Object.freeze({ allowed: false, reason: `interceptor-failed: ${reason}`, interceptor });
  }
}
