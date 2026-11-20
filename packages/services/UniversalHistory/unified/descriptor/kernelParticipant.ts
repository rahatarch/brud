import {
  ExposedApiRegistryToken,
  withExposureBindings,
  type ExposedApiCaller,
  type IExposedApiRegistry,
  type IKernelAccessBroker,
  type ServiceContext,
  type ServiceDescriptor,
  type ServiceTier,
  type ServiceToken,
} from '@brud/kernel';

/** What `create`, handles and `onRunning` receive. */
export interface KernelParticipantContext<T extends object> {
  readonly instance: T;
  readonly running: boolean;
  /** Boot options the kernel hands this participant. */
  readonly bootOptions: Readonly<Record<string, unknown>>;
  /** Boot logger, when configured. */
  readonly logger: ServiceContext['logger'];
  resolve<R>(name: string): R | null;
}

/** One declared exposure. */
export interface KernelExposure<T extends object> {
  readonly version: number;
  readonly scope: 'kernel' | 'runtime' | 'host' | 'any';
  readonly policy?: Readonly<Record<string, unknown>>;
  readonly handle: (caller: ExposedApiCaller, ctx: KernelParticipantContext<T>) => object | null;
}

/**
 * Builds a participant descriptor straight from the kernel primitives
 * (manifest + `withExposureBindings` + registry fetched at `onRunning`), as in
 * docs/kernel-api/guides/writing-a-participant.md.
 *
 * Used instead of `@brud/sdk` `defineParticipant` because the SDK requires a
 * lower-case participant id and this service's token id is camelCase
 * (`brud.core.universalHistory`). Renaming the token would break every caller.
 */
export function kernelParticipant<T extends object>(definition: {
  readonly token: ServiceToken<T>;
  readonly tier: ServiceTier;
  readonly requests?: readonly string[];
  readonly exposes: Readonly<Record<string, KernelExposure<T>>>;
  readonly create: (ctx: KernelParticipantContext<T>) => T;
  readonly onRunning?: (ctx: KernelParticipantContext<T>) => void | Promise<void>;
}): ServiceDescriptor<T> {
  const entries = Object.entries(definition.exposes);

  return {
    token: definition.token,
    tier: definition.tier,
    dependencies: [],
    manifest: {
      requests: { capabilities: [...(definition.requests ?? [])] },
      exposures: entries.map(([name, exposure]) => ({
        name,
        version: exposure.version,
        scope: exposure.scope,
        ...(exposure.policy === undefined ? {} : { policy: exposure.policy }),
      })),
      events: [],
    },
    factory: (bootContext?: ServiceContext): T => {
      let registry: IExposedApiRegistry | undefined;
      let instance: T | undefined;
      const ctx: KernelParticipantContext<T> = {
        bootOptions: bootContext?.options ?? {},
        logger: bootContext?.logger,
        get instance(): T {
          if (instance === undefined) {
            throw new Error(`${definition.token.id}: instance not created yet`);
          }

          return instance;
        },
        get running(): boolean {
          return registry !== undefined;
        },
        resolve: <R>(name: string): R | null => (registry === undefined ? null : registry.resolve<R>(name)),
      };

      instance = definition.create(ctx);
      const own = (instance as { onRunning?: unknown }).onRunning;

      Object.defineProperty(instance, 'onRunning', {
        value: async (broker: IKernelAccessBroker): Promise<void> => {
          registry = broker.requestAccess(
            { callerId: definition.token.id, tier: definition.tier, options: {} },
            ExposedApiRegistryToken,
          );

          if (typeof own === 'function') {
            await (own as (b: IKernelAccessBroker) => unknown).call(instance, broker);
          }

          await definition.onRunning?.(ctx);
        },
        enumerable: false,
        configurable: true,
      });

      return withExposureBindings(instance, Object.fromEntries(entries.map(([name, exposure]) => [
        `${name}@${String(exposure.version)}`,
        { projection: (_service: unknown, caller: ExposedApiCaller) => exposure.handle(caller, ctx) },
      ])));
    },
  } as unknown as ServiceDescriptor<T>;
}
