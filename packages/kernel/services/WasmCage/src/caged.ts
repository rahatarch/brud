import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  IKernelAccessBroker,
  ParticipantManifest,
  ServiceDescriptor,
} from '../../../src/contracts/index.js';
import { createServiceToken } from '../../../src/contracts/index.js';
import { compileJsonSchema } from '../../../src/validation/jsonSchema/index.js';
import { ExposedApiRegistryToken, withExposureBindings } from '../../ExposedApiRegistry/index.js';
import type { ExposedApiBinding, ExposedApiCaller } from '../../ExposedApiRegistry/index.js';
import { InterceptionBlockedError } from '../../Interception/index.js';
import { loadVerifiedNative } from './native.js';
import type { IInterceptionService, InterceptedCall, InterceptionVerdict } from '../../Interception/index.js';

/**
 * Caged participants: code running inside the WASM cage with full participant
 * parity (Architect ruling I-07). The kernel already treats a caged participant
 * like any other; this module is the host side of the cage's call *in*.
 *
 * ## Guest ABI
 *
 * A caged participant's module exports:
 * - `memory` — its linear memory;
 * - `brud_alloc(len: i32) -> i32` — returns a pointer to `len` writable bytes;
 * - `brud_invoke(ptr: i32, len: i32) -> i64` — a call on one of its exposures;
 * - `brud_intercept(ptr: i32, len: i32) -> i64` — an interception verdict
 *   (only when the manifest declares `interceptions`);
 * - optionally `brud_start(ptr: i32, len: i32) -> i64` — called once when the
 *   participant starts running, with `{ kind: 'start', token }`; it answers
 *   `{ ok: true }` or `{ ok: false, error }` (a failure fails the start).
 *
 * It may import `brud.call(ptr: i32, len: i32) -> i64`, the routed call (its
 * only call out): the request is `{ name, version?, method, args }`; the host
 * resolves the exposure through the exposed-API registry as this participant,
 * exactly as a native participant resolves, calls `method` with `args`, and
 * answers `{ ok: true, value }` or `{ ok: false, error: { code, message } }`.
 * A routed call is only possible while the host is calling the guest; a routed
 * call back into the same instance is refused (re-entrancy fails closed).
 *
 * Routed calls may be async. The guest is suspended on a Wasmtime fiber while
 * the host awaits, inside the original caller's call chain, then resumed with
 * the result; the guest code stays synchronous. A caged exposure is sync when
 * every routed call it made answered synchronously, and returns a Promise when
 * one was awaited — exactly like native code. Interceptors stay synchronous:
 * an awaited routed call from `brud_intercept` is answered with an error.
 *
 * The host writes a UTF-8 JSON request at the pointer `brud_alloc` returned and
 * calls the export with `(ptr, len)`. The export returns `(ptr << 32) | len` of
 * a UTF-8 JSON response in its memory.
 *
 * - `brud_invoke` request: `{ kind: 'invoke', exposure, method, args, caller }`
 *   where `caller` is `{ identity, callerClass, official, capabilities[], origin }`.
 *   Response: `{ ok: true, value }` or `{ ok: false, error: { code, message } }`.
 * - `brud_intercept` request: the {@link InterceptedCall} as JSON. Response:
 *   an {@link InterceptionVerdict}.
 *
 * ## Security properties
 *
 * Plain values only (JSON in, JSON out; arguments are validated as JSON before
 * they cross). Every call runs under a fresh fuel budget (its deadline); the
 * memory limit is enforced at instantiation and on every growth; responses
 * over 1 MiB are refused. A trap, an exhausted budget, a malformed response, or
 * an invalid verdict fails closed: the call throws.
 *
 * The cage's outward surface is unchanged: `resolve` (through `brud.call`)
 * stays a caged participant's only call out (W-09). Plain values only: a
 * routed result that is not plain JSON (functions, handles, class instances,
 * non-finite numbers) is refused. Each call into the guest has a wall-clock
 * deadline (`deadlineMs`): once it passes, every routed call is answered with
 * `WASM_CAGE_ROUTED_TIMEOUT`, and fuel bounds the guest's remaining work. A
 * routed call may opt in to cancellation with `"abortable": true`: its last
 * argument must be a plain options object, and the host adds the call's
 * `AbortSignal` to it as `signal`, aborted when the deadline passes.
 *
 * Calls into a busy instance wait their turn (FIFO, at most 64 queued; the
 * deadline counts from the moment a call is queued). A guest calling back into
 * its own instance is refused, since waiting for itself would deadlock;
 * interceptors cannot wait, so a busy instance fails them closed.
 */

/** Resource limits for one caged participant. */
export interface CagedParticipantLimits {
  /** Fuel per call: the call's deadline. */
  readonly fuel: number;
  /** Maximum linear-memory size in bytes. */
  readonly maxMemoryBytes: number;
  /** Wall-clock deadline per call into the guest, in milliseconds (default 30 s). */
  readonly deadlineMs?: number;
}

/** Options for {@link createCagedParticipant}. */
export interface CagedParticipantOptions {
  /** The participant's service token id. */
  readonly token: string;
  /** The participant's manifest, declared exactly as a native participant's. */
  readonly manifest: ParticipantManifest;
  /** The guest module: WASM binary or WAT text bytes. */
  readonly wasm: Uint8Array;
  /** Resource limits. */
  readonly limits?: CagedParticipantLimits;
}

/** Default caged-participant limits. */
export const DEFAULT_CAGED_LIMITS: CagedParticipantLimits = Object.freeze({
  fuel: 10_000_000,
  maxMemoryBytes: 16 * 1024 * 1024,
  deadlineMs: 30_000,
});

/** A caged guest failed: a trap, an exhausted budget, or a refused response. */
export class CagedGuestError extends Error {
  public readonly code = 'WASM_CAGE_GUEST_FAILED' as const;

  /** The guest-reported error code, when the guest reported one. */
  public readonly guestCode: string | undefined;

  constructor(message: string, guestCode?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CagedGuestError';
    this.guestCode = guestCode;
  }
}

interface CallStep {
  readonly done: boolean;
  readonly response?: string | null;
  readonly request?: string | null;
}

interface NativeInstance {
  callJson(name: string, request: string): CallStep;
  resume(response: string): CallStep;
  hasExport(name: string): boolean;
}

interface NativeCage {
  readonly CageEngine: new () => object;
  readonly CageModule: { compile(engine: object, bytes: Buffer): object };
  readonly CageInstance: {
    instantiate(
      module: object,
      imports: readonly unknown[],
      limits: { fuel: number; maxMemoryBytes: number; timeoutMs: number },
    ): NativeInstance;
  };
}

let engine: object | undefined;

function loadNative(): { readonly cage: NativeCage; readonly engine: object } {
  const cage = loadVerifiedNative<NativeCage>();

  engine ??= new cage.CageEngine();

  return { cage, engine };
}

const argsSchema = (() => {
  const compiled = compileJsonSchema({ type: 'array' });

  if (!compiled.ok) {
    throw new Error('caged participant: argument schema failed to compile');
  }

  return compiled.schema;
})();

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }

    Object.freeze(value);
  }

  return value;
}

/** Serves one routed request; a Promise when the call it made was async. */
type RoutedCallback = (request: string, signal: AbortSignal) => string | Promise<string>;

function guestFailure(exportName: string, error: unknown): CagedGuestError {
  return error instanceof CagedGuestError
    ? error
    : new CagedGuestError(`caged guest "${exportName}" failed: ${(error as Error).message}`, undefined, { cause: error });
}

function step(exportName: string, run: () => CallStep): CallStep {
  try {
    return run();
  } catch (error) {
    throw guestFailure(exportName, error);
  }
}

function finish(exportName: string, final: CallStep): unknown {
  try {
    return JSON.parse(final.response ?? '') as unknown;
  } catch (error) {
    throw new CagedGuestError(`caged guest "${exportName}" returned malformed JSON`, undefined, { cause: error });
  }
}

const timeoutResponse = (): string => routedError('WASM_CAGE_ROUTED_TIMEOUT', 'the call into the cage passed its deadline');

/** Resolves with the routed answer, or with a timeout answer at the deadline. */
async function withDeadline(pending: Promise<string>, deadline: number, controller: AbortController): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<string>((resolve) => {
    timer = setTimeout(() => {
      controller.abort(new CagedGuestError('the call into the cage passed its deadline', 'WASM_CAGE_ROUTED_TIMEOUT'));
      resolve(timeoutResponse());
    }, Math.max(0, deadline - Date.now()));
  });

  try {
    return await Promise.race([pending, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Drives one call into the guest. Routed requests answered synchronously are
 * resumed at once, so a guest that awaits nothing completes synchronously;
 * the first awaited answer switches the rest of the call to async.
 */
function callGuest(
  instance: NativeInstance,
  exportName: string,
  request: unknown,
  routed: RoutedCallback,
  deadline: number,
  allowAsync: boolean,
): unknown {
  const controller = new AbortController();
  let current = step(exportName, () => instance.callJson(exportName, JSON.stringify(request)));

  while (!current.done) {
    const answer = Date.now() >= deadline ? timeoutResponse() : routed(current.request ?? '', controller.signal);

    if (typeof answer !== 'string') {
      if (!allowAsync) {
        answer.catch(() => undefined);
        current = step(exportName, () => instance.resume(routedError('WASM_CAGE_ROUTED_ASYNC', 'this guest entry cannot await a routed call')));
        continue;
      }

      return (async (): Promise<unknown> => {
        let next: string | Promise<string> = answer;

        for (;;) {
          const resolved: string = typeof next === 'string' ? next : await withDeadline(next, deadline, controller);

          current = step(exportName, () => instance.resume(resolved));

          if (current.done) {
            return finish(exportName, current);
          }

          next = Date.now() >= deadline ? timeoutResponse() : routed(current.request ?? '', controller.signal);
        }
      })();
    }

    current = step(exportName, () => instance.resume(answer));
  }

  return finish(exportName, current);
}

const MAX_PLAIN_DEPTH = 64;

/** Plain JSON only: null, booleans, finite numbers, strings, arrays and plain objects. */
function isPlainJson(value: unknown, depth = 0): boolean {
  if (depth > MAX_PLAIN_DEPTH) {
    return false;
  }

  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return true;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every((item) => isPlainJson(item, depth + 1));
  }

  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value) as unknown;

    return (prototype === Object.prototype || prototype === null)
      && Object.values(value).every((item) => isPlainJson(item, depth + 1));
  }

  return false;
}

function plainCaller(caller: ExposedApiCaller): Record<string, unknown> {
  return {
    identity: caller.identity,
    callerClass: caller.callerClass,
    official: caller.official,
    capabilities: [...caller.capabilities].sort(),
    origin: caller.origin,
  };
}

function isVerdict(value: unknown): value is InterceptionVerdict {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const verdict = value as { verdict?: unknown; reason?: unknown; args?: unknown };

  return verdict.verdict === 'allow'
    || (verdict.verdict === 'block' && typeof verdict.reason === 'string')
    || (verdict.verdict === 'modify' && Array.isArray(verdict.args));
}

interface RegistryAccess {
  resolve<T>(name: string, options?: { readonly version?: number | string }): T | null;
}

/** A routed-call failure, as plain values. */
function routedError(code: string, message: string): string {
  return JSON.stringify({ ok: false, error: { code, message } });
}

/** A routed result as a plain response. */
function plainResponse(value: unknown): string {
  const plain = value === undefined ? null : value;

  return isPlainJson(plain)
    ? JSON.stringify({ ok: true, value: plain })
    : routedError('WASM_CAGE_ROUTED_NOT_PLAIN', 'the routed result is not plain JSON');
}

function failureResponse(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;

  return routedError(typeof code === 'string' ? code : 'WASM_CAGE_ROUTED_FAILED', String((error as Error | null)?.message ?? error));
}

/**
 * Serves one routed call: resolve as the caged participant, call the method,
 * answer with plain values. Never throws; every failure is a plain error
 * response. Returns a Promise when the called method returned one.
 */
function serveRoutedCall(registry: () => RegistryAccess, raw: string, signal: AbortSignal): string | Promise<string> {
  try {
    const request = JSON.parse(raw) as { name?: unknown; version?: unknown; method?: unknown; args?: unknown; abortable?: unknown };

    if (typeof request.name !== 'string' || typeof request.method !== 'string' || !Array.isArray(request.args)
      || (request.version !== undefined && typeof request.version !== 'number' && typeof request.version !== 'string')) {
      return routedError('WASM_CAGE_ROUTED_INVALID', 'a routed call needs a string name, a string method and an args array');
    }

    const options = request.version === undefined ? undefined : { version: request.version };
    const handle = registry().resolve<Record<string, unknown>>(request.name, options);

    if (handle === null) {
      return routedError('WASM_CAGE_ROUTED_NOT_FOUND', `exposure "${request.name}" did not resolve`);
    }

    const method = handle[request.method];

    if (typeof method !== 'function') {
      return routedError('WASM_CAGE_ROUTED_NOT_FOUND', `exposure "${request.name}" has no method "${request.method}"`);
    }

    let args = request.args as unknown[];

    if (request.abortable === true) {
      const last = args[args.length - 1];

      if (last === null || typeof last !== 'object' || Array.isArray(last)) {
        return routedError('WASM_CAGE_ROUTED_INVALID', 'an abortable routed call needs a plain options object as its last argument');
      }

      args = [...args.slice(0, -1), { ...(last as Record<string, unknown>), signal }];
    }

    const value = (method as (...args: unknown[]) => unknown).apply(handle, args);

    if (value !== null && typeof value === 'object' && typeof (value as { then?: unknown }).then === 'function') {
      return Promise.resolve(value).then(plainResponse, failureResponse);
    }

    return plainResponse(value);
  } catch (error) {
    return failureResponse(error);
  }
}

/** The instances whose guest call the current async context is inside. */
const activeInstances = new AsyncLocalStorage<ReadonlySet<object>>();
const MAX_QUEUED_CALLS = 64;

/**
 * Serializes calls into one guest instance: one runs at a time, later ones
 * wait (FIFO). A call made from inside this instance's own call is refused.
 */
function createScheduler(instance: NativeInstance, routed: RoutedCallback, deadlineMs: number) {
  const self = {};
  const waiting: (() => void)[] = [];
  let running = false;

  const release = (): void => {
    running = false;
    waiting.shift()?.();
  };

  const start = (exportName: string, request: unknown, deadline: number, allowAsync: boolean): unknown => {
    if (Date.now() >= deadline) {
      throw new CagedGuestError(`caged guest "${exportName}" waited past its deadline`, 'WASM_CAGE_QUEUE_TIMEOUT');
    }

    running = true;
    const inside = new Set(activeInstances.getStore() ?? []).add(self);
    let outcome: unknown;

    try {
      outcome = activeInstances.run(inside, () => callGuest(instance, exportName, request, routed, deadline, allowAsync));
    } catch (error) {
      release();
      throw error;
    }

    if (outcome instanceof Promise) {
      return outcome.finally(release);
    }

    release();

    return outcome;
  };

  return (exportName: string, request: unknown, allowAsync: boolean): unknown => {
    if (activeInstances.getStore()?.has(self) === true) {
      throw new CagedGuestError(`caged guest "${exportName}" failed: re-entrant call into a busy cage instance`);
    }

    const deadline = Date.now() + deadlineMs;

    if (!running && waiting.length === 0) {
      return start(exportName, request, deadline, allowAsync);
    }

    if (!allowAsync || waiting.length >= MAX_QUEUED_CALLS) {
      throw new CagedGuestError(`caged guest "${exportName}" failed: the cage instance is busy`);
    }

    return new Promise<unknown>((resolve, reject) => {
      waiting.push(() => {
        try {
          Promise.resolve(start(exportName, request, deadline, allowAsync)).then(resolve, reject);
        } catch (error) {
          reject(error as Error);
        }
      });
    });
  };
}

function majorOf(version: number | string | undefined): number {
  return version === undefined ? 1 : Number(String(version).split('.')[0]);
}

/**
 * Builds the descriptor of a caged participant: a participant whose code runs
 * inside the WASM cage and which may be a giver (exposures and interception
 * points) and an interceptor, exactly like a native participant.
 *
 * @param options - Token, manifest, guest module, and limits.
 * @returns The participant's descriptor.
 */
export function createCagedParticipant(options: CagedParticipantOptions): ServiceDescriptor<object> {
  const token = createServiceToken<object>(options.token, `Caged participant "${options.token}"`);
  const limits = options.limits ?? DEFAULT_CAGED_LIMITS;
  const deadlineMs = limits.deadlineMs ?? DEFAULT_CAGED_LIMITS.deadlineMs ?? 30_000;
  const manifest = options.manifest;
  const points = new Set((manifest.interceptionPoints ?? []).map((point) => point.exposure));

  return {
    token,
    tier: 'userland',
    dependencies: [],
    manifest,
    factory: (_context, broker): object => {
      const { cage, engine: cageEngine } = loadNative();
      const module = cage.CageModule.compile(cageEngine, Buffer.from(options.wasm));
      const guest = cage.CageInstance.instantiate(module, [{ module: 'brud', name: 'call', kind: 'RoutedCall' }], {
        fuel: limits.fuel,
        maxMemoryBytes: limits.maxMemoryBytes,
        timeoutMs: 0,
      });
      let evaluator: IInterceptionService | null = null;
      let registryAccess: RegistryAccess | undefined;
      const registry = (): RegistryAccess => {
        registryAccess ??= broker.requestAccess(
          { callerId: token.id, tier: 'userland', options: {} },
          ExposedApiRegistryToken as unknown as Parameters<IKernelAccessBroker['requestAccess']>[1],
        ) as RegistryAccess;

        return registryAccess;
      };
      const routed: RoutedCallback = (request, signal) => serveRoutedCall(registry, request, signal);
      const run = createScheduler(guest, routed, deadlineMs);

      const invoke = (exposure: string, method: string, args: readonly unknown[], caller: ExposedApiCaller): unknown => {
        const validation = argsSchema.validate(args);

        if (!validation.valid) {
          throw new CagedGuestError(`caged call "${exposure}.${method}": arguments are not plain values`);
        }

        let callArgs = args;
        const name = exposure.slice(0, exposure.lastIndexOf('@'));

        if (points.has(name)) {
          if (evaluator === null) {
            throw new InterceptionBlockedError(exposure, 'interception unavailable');
          }

          const outcome = evaluator.evaluate(exposure, method, callArgs, { caller });

          if (!outcome.allowed) {
            throw new InterceptionBlockedError(exposure, outcome.reason, outcome.interceptor);
          }

          callArgs = outcome.args;
        }

        const settle = (raw: unknown): unknown => {
          const response = raw as { ok?: unknown; value?: unknown; error?: { code?: unknown; message?: unknown } } | null;

          if (response?.ok === true) {
            return deepFreeze(response.value);
          }

          const code = typeof response?.error?.code === 'string' ? response.error.code : undefined;
          const message = typeof response?.error?.message === 'string' ? response.error.message : 'guest refused the call';

          throw new CagedGuestError(`caged call "${exposure}.${method}" failed: ${message}`, code);
        };
        const outcome = run('brud_invoke', {
          kind: 'invoke',
          exposure,
          method,
          args: callArgs,
          caller: plainCaller(caller),
        }, true);

        return outcome instanceof Promise ? outcome.then(settle) : settle(outcome);
      };
      const bindings: Record<string, ExposedApiBinding> = {};

      for (const declaration of manifest.exposures ?? []) {
        const exposure = `${declaration.name}@${String(majorOf(declaration.version))}`;

        bindings[exposure] = {
          projection: (_service: unknown, caller: ExposedApiCaller): unknown => new Proxy(Object.freeze({}), {
            get: (_target, method) => (typeof method !== 'string' || method === 'then' || method === 'toJSON'
              ? undefined
              : (...args: unknown[]): unknown => invoke(exposure, method, args, caller)),
          }),
        };
      }

      const instance = {
        async onRunning(): Promise<void> {
          if (points.size > 0) {
            evaluator = registry().resolve<IInterceptionService>('interception.evaluate');
          }

          if (guest.hasExport('brud_start')) {
            const started = await run('brud_start', { kind: 'start', token: token.id }, true) as
              { ok?: unknown; error?: { message?: unknown } } | null;

            if (started?.ok !== true) {
              const message = typeof started?.error?.message === 'string' ? started.error.message : 'guest refused to start';

              throw new CagedGuestError(`caged participant "${token.id}" failed to start: ${message}`);
            }
          }
        },
      };

      if ((manifest.interceptions ?? []).length > 0) {
        Object.defineProperty(instance, 'intercept', {
          value: (call: InterceptedCall): InterceptionVerdict => {
            const verdict = run('brud_intercept', call, false);

            if (!isVerdict(verdict)) {
              throw new CagedGuestError('invalid verdict');
            }

            return deepFreeze(verdict);
          },
          enumerable: false,
        });
      }

      return withExposureBindings(instance, bindings);
    },
  };
}
