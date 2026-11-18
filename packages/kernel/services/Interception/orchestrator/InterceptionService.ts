import type {
  AdmittedManifest,
  KernelCallAuthority,
} from '../../../src/contracts/index.js';
import { compileJsonSchema } from '../../../src/validation/jsonSchema/index.js';
import { freezeJsonCopy } from '../../../src/validation/jsonSchema/jsonValue.js';
import type { ExposedApiCaller } from '../../ExposedApiRegistry/contracts/types.js';
import { InterceptionDeclarationError } from '../contracts/errors.js';
import type {
  IInterceptionService,
  IInterceptor,
  InterceptedCall,
  InterceptionEvaluateOptions,
  InterceptionOutcome,
  InterceptionVerdict,
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
}

/** One interception point: a giver's exposure and its ordered interceptors. */
interface InterceptionPoint {
  readonly key: string;
  readonly owner: string;
  readonly interceptors: readonly AdmittedInterceptor[];
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

          return Object.freeze({ token, identity: interceptor.identity });
        });

        this.#points.set(key, Object.freeze({ key, owner, interceptors: Object.freeze(interceptors) }));
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
        capabilities: Object.freeze(Array.from(caller.capabilities ?? []).sort()),
        origin: caller.origin,
      }),
    });
    const modifiedBy: string[] = [];

    for (const interceptor of point.interceptors) {
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

  #refuse(key: string, reason: string): InterceptionOutcome {
    this.authority?.observe(OBSERVATION_SOURCE, 'interception.refused', { target: key, reason });

    return Object.freeze({ allowed: false, reason });
  }

  #fail(key: string, interceptor: string, reason: string): InterceptionOutcome {
    this.authority?.observe(OBSERVATION_SOURCE, 'interception.failed', { target: key, interceptor, reason });

    return Object.freeze({ allowed: false, reason: `interceptor-failed: ${reason}`, interceptor });
  }
}
