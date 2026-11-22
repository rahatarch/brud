import {
  ExposedApiRegistryToken,
  createServiceToken,
  withExposureBindings,
  type ExposedApiBinding,
  type ExposedApiCaller,
  type ExposedApiRefusal,
  type ExposedApiResolveOptions,
  type IExposedApiRegistry,
  type IKernelAccessBroker,
  type KernelServiceModuleContext,
  type ServiceContext,
  type ServiceDescriptor,
  type ServiceTier,
} from '@brud/kernel';
import { SdkError } from '../core/errors.js';
import { assertMajor, assertName, exposureKey } from '../core/names.js';

/** Who may reach an exposure, by call origin (kernel scope semantics). */
export type ExposureScope = 'kernel' | 'runtime' | 'host' | 'any';

/** What `lastRefusal` reports before the registry is attached. */
const NOT_ATTACHED: ExposedApiRefusal = Object.freeze({
  code: 'no-call-context',
  message: 'no kernel call context: exposures are not attached yet (for example during synchronous create)',
});

/** What a participant's code sees: its id, options, instance, and `resolve`. */
export interface ParticipantContext<TInstance extends object> {
  /** The participant's declared id (its name; the kernel issues its identity). */
  readonly id: string;
  /** Composition options passed to the service module. */
  readonly options: Readonly<Record<string, unknown>>;
  /** Boot options the kernel hands this participant (e.g. `settings.root`). */
  readonly bootOptions: Readonly<Record<string, unknown>>;
  /** Boot logger the kernel hands this participant, when one is configured. */
  readonly logger: ServiceContext['logger'];
  /** The instance `create` returned. */
  readonly instance: TInstance;
  /** True once the kernel is running and `resolve` is live. */
  readonly running: boolean;
  /**
   * Resolves another giver's exposure, as this participant. Returns `null` when
   * scope or policy refuses, and before the participant is running.
   */
  resolve<T = unknown>(name: string, options?: ExposedApiResolveOptions): T | null;
  /**
   * Why the most recent `resolve` returned `null`, or `null` when it succeeded.
   * Before the participant is running (for example in `create`) exposures are
   * not attached yet, so this reports `no-call-context`.
   */
  lastRefusal(): ExposedApiRefusal | null;
}

/**
 * Builds the handle a caller receives (the exposure's Layer 2 projection).
 * Runs at resolve time with the real caller's view; return `null` to refuse.
 */
export type ExposureHandle<TInstance extends object> = (
  caller: ExposedApiCaller,
  ctx: ParticipantContext<TInstance>,
) => object | null;

/** One exposure a participant gives. */
export interface ExposureDefinition<TInstance extends object> {
  /** Major version (default 1). */
  readonly version?: number;
  /** Origins admitted (default `runtime`). */
  readonly scope?: ExposureScope;
  /** Layer 1 policy (`policyVersion: 2`), evaluated by the kernel before `handle`. */
  readonly policy?: Readonly<Record<string, unknown>>;
  /** The caller-shaped handle. */
  readonly handle: ExposureHandle<TInstance>;
}

/** A participant, defined once. */
export interface ParticipantDefinition<TInstance extends object> {
  /** Dotted lower-case id, e.g. `acme.notes`. */
  readonly id: string;
  readonly description?: string;
  /** Default `userland`. */
  readonly tier?: ServiceTier;
  /** Capabilities this participant requests for itself. */
  readonly requests?: readonly string[];
  /** Exposures, keyed by exposure name. */
  readonly exposes?: Readonly<Record<string, ExposureDefinition<TInstance>>>;
  /** Builds the participant's instance. */
  readonly create: (ctx: ParticipantContext<TInstance>) => TInstance;
  /** Runs once the kernel is running (`resolve` is live). */
  readonly onRunning?: (ctx: ParticipantContext<TInstance>) => void | Promise<void>;
}

/** A service module's `createService`. */
export type CreateService<TInstance extends object> = (
  context?: KernelServiceModuleContext,
) => ServiceDescriptor<TInstance>;

/**
 * Defines a participant and returns its service module's `createService`.
 *
 * The result is the exact descriptor the kernel accepts (token, manifest,
 * exposure bindings, lifecycle); the kernel validates and enforces it as if it
 * were hand-written. Export it as `createService`:
 *
 * ```ts
 * export const createService = defineParticipant({ id: 'acme.notes', create: () => new Notes(), exposes: { … } });
 * ```
 *
 * @throws {SdkError} `SDK_DEFINITION_INVALID` for an invalid definition.
 */
export function defineParticipant<TInstance extends object>(
  definition: ParticipantDefinition<TInstance>,
): CreateService<TInstance> {
  const id = assertName(definition.id, 'participant id');
  const tier = definition.tier ?? 'userland';
  const exposures = Object.entries(definition.exposes ?? {}).map(([name, exposure]) => ({
    name: assertName(name, `exposure of ${id}`),
    major: assertMajor(exposure.version, `exposure ${name}`),
    exposure,
  }));

  if (typeof definition.create !== 'function') {
    throw new SdkError('SDK_DEFINITION_INVALID', `participant ${id}: create must be a function`);
  }

  const manifest = Object.freeze({
    requests: { capabilities: [...(definition.requests ?? [])] },
    exposures: exposures.map(({ name, major, exposure }) => ({
      name,
      version: major,
      scope: exposure.scope ?? 'runtime',
      ...(exposure.policy === undefined ? {} : { policy: exposure.policy }),
    })),
    events: [],
  });
  const token = createServiceToken<TInstance>(id, definition.description ?? `Participant "${id}"`);

  return (moduleContext?: KernelServiceModuleContext): ServiceDescriptor<TInstance> => ({
    token,
    tier,
    dependencies: [],
    manifest,
    factory: (bootContext?: ServiceContext): TInstance => {
      let registry: IExposedApiRegistry | undefined;
      let instance: TInstance | undefined;
      const ctx: ParticipantContext<TInstance> = {
        id,
        options: moduleContext?.options ?? {},
        bootOptions: bootContext?.options ?? {},
        logger: bootContext?.logger,
        get instance(): TInstance {
          if (instance === undefined) {
            throw new SdkError('SDK_INSTANCE_NOT_READY', `participant ${id}: the instance is not created yet`);
          }

          return instance;
        },
        get running(): boolean {
          return registry !== undefined;
        },
        resolve: <T>(name: string, options?: ExposedApiResolveOptions): T | null =>
          registry === undefined ? null : registry.resolve<T>(name, options),
        lastRefusal: (): ExposedApiRefusal | null =>
          registry === undefined ? NOT_ATTACHED : registry.lastRefusal(),
      };

      const created = definition.create(ctx);

      if (created === null || typeof created !== 'object') {
        throw new SdkError('SDK_DEFINITION_INVALID', `participant ${id}: create must return an object`);
      }

      instance = created;
      const own = (created as { onRunning?: unknown }).onRunning;

      Object.defineProperty(created, 'onRunning', {
        value: async (broker: IKernelAccessBroker): Promise<void> => {
          registry = broker.requestAccess({ callerId: id, tier, options: {} }, ExposedApiRegistryToken);

          if (typeof own === 'function') {
            await (own as (b: IKernelAccessBroker) => unknown).call(created, broker);
          }

          await definition.onRunning?.(ctx);
        },
        enumerable: false,
        configurable: true,
      });

      const bindings: Record<string, ExposedApiBinding> = {};

      for (const { name, major, exposure } of exposures) {
        bindings[exposureKey(name, major)] = {
          projection: (_service: unknown, caller: ExposedApiCaller) => exposure.handle(caller, ctx),
        };
      }

      return withExposureBindings(created, bindings);
    },
  });
}
