import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ServiceDescriptor } from '../contracts/serviceDescriptor.js';
import {
  ContextContract,
  ContextContractError,
  type ContextFieldDeclaration,
  type ContextScopeDeclaration,
} from '../contracts/contextContract.js';
import type { KernelCaller } from '../contracts/callChain.js';
import { admitParticipantManifest } from '../contracts/manifest.js';
import type { ChainParticipant } from '../engine/callChain.js';
import type { KernelLogger, IServiceLifecycle } from '../contracts/lifecycle.js';
import type { KernelBootOptions } from '../contracts/kernel.js';
import { BrudKernel } from '../engine/BrudKernel.js';
import {
  protectConfigFile,
  recordConfigRead,
  releaseConfigProtection,
  verifyConfigIntegrity,
} from './config/integrity.js';
import { lineOf, parseBrudConfig } from './config/parse.js';
import {
  buildHardcoreBootEntries,
  invokeHardcoreBootHooks,
  verifyHardcoreServices,
  type ComposedServiceDescriptor,
  type HardcoreBootEntry,
} from './hardcore.js';
import { HARDCORE_SERVICES } from './hardcoreServices.js';
import {
  BrudConfigError,
  type BrudConfig,
  type BrudConfigEntry,
} from './config/types.js';
import type {
  BootKernelOptions,
  ComposeKernelOptions,
  KernelServiceModuleContext,
  ServiceModule,
} from './bootTypes.js';

/** Root the `kernel:` module prefix resolves from (`packages/kernel/`). */
const KERNEL_PACKAGE_ROOT = new URL('../../', import.meta.url);

/** Fallback diagnostic sink used when the host does not supply one. */
const DEFAULT_KERNEL_LOGGER: KernelLogger = {
  warn: (message, meta) => {
    console.warn(message, meta ?? {});
  },
};

interface LoadedService {
  readonly index: number;
  readonly entry: BrudConfigEntry;
  readonly module: unknown;
  readonly resolvedId: string;
}

/** Returns the boot-policy hook exported by a module, if any. */
function pinBootPoliciesHook(
  moduleValue: unknown,
): NonNullable<ServiceModule['pinBootPolicies']> | undefined {
  if (!isRecord(moduleValue) || typeof moduleValue.pinBootPolicies !== 'function') {
    return undefined;
  }

  return moduleValue.pinBootPolicies as unknown as NonNullable<
    ServiceModule['pinBootPolicies']
  >;
}

/** Returns the boot-registrant hook exported by a module, if any. */
function registerBootRegistrantsHook(
  moduleValue: unknown,
): NonNullable<ServiceModule['registerBootRegistrants']> | undefined {
  if (!isRecord(moduleValue) || typeof moduleValue.registerBootRegistrants !== 'function') {
    return undefined;
  }

  return moduleValue.registerBootRegistrants as unknown as NonNullable<
    ServiceModule['registerBootRegistrants']
  >;
}

/**
 * Reads, validates, composes, and boots a kernel from `brud.config.json`.
 *
 * @param configPath - Path to the config file.
 * @param options - Generic options bag and logger.
 */
export async function bootKernel(
  configPath: string,
  options: BootKernelOptions,
): Promise<BrudKernel> {
  const kernel = createDeferredKernel(configPath, options);

  await kernel.boot({
    ...(options.options === undefined ? {} : { options: options.options }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });

  return kernel;
}

/**
 * Builds a kernel whose config is composed lazily on the first `boot()`.
 *
 * The host supplies the config path explicitly; the kernel never chooses or
 * discovers a config. Deferring module imports until boot keeps module
 * instances in the ESM cache instead of loading a second copy through
 * `require`.
 */
export function createDeferredKernel(
  configPath: string,
  options: ComposeKernelOptions,
): BrudKernel {
  let loadedServices: readonly LoadedService[] = [];
  let serviceContext: KernelServiceModuleContext | undefined;
  let hardcoreBootEntries: readonly HardcoreBootEntry[] = [];
  let hardcorePackageHashes: ReadonlyMap<string, string> = new Map();
  let composedConfig: BrudConfig = { services: [] };
  let activeServiceOwner = 'brud.kernel.composition';
  const contextContract = new ContextContract();

  function declareContextFields(
    scopeOrDeclaration: string | ContextScopeDeclaration,
    fields?: readonly ContextFieldDeclaration[],
  ): void {
    contextContract.declare(activeServiceOwner, scopeOrDeclaration, fields);
  }

  const kernel = new BrudKernel({
    contextContract,
    hardcoreTokens: HARDCORE_SERVICES.map((service) => service.token),
    bootHardcore: (instances, authority): readonly ChainParticipant[] => {
      const identities = invokeHardcoreBootHooks(
        HARDCORE_SERVICES,
        instances,
        hardcorePackageHashes,
        hardcoreBootEntries,
        composedConfig,
        authority,
      );

      // Each participant's caller is assigned here, by the kernel: its issued
      // identity, its official status from the identity-to-official mapping,
      // and the capabilities its manifest requests.
      return hardcoreBootEntries.map((entry): ChainParticipant => {
        const caller: KernelCaller = Object.freeze({
          callerClass: 'participant',
          identity: identities.get(entry.token) ?? null,
          official: entry.official,
          capabilities: Object.freeze(new Set(entry.manifest.capabilities)),
        });

        return { tokenId: entry.token, caller };
      });
    },
    bootPinner: async (instances: readonly IServiceLifecycle[]): Promise<void> => {
      const context = serviceContext;

      if (context === undefined) {
        return;
      }

      for (const loaded of loadedServices) {
        const pin = pinBootPoliciesHook(loaded.module);

        if (pin !== undefined) {
          activeServiceOwner = `${String(loaded.index)}:${loaded.entry.path}`;
          await pin(context, instances);
        }
      }

      for (const loaded of loadedServices) {
        const registrant = registerBootRegistrantsHook(loaded.module);

        if (registrant !== undefined) {
          activeServiceOwner = `${String(loaded.index)}:${loaded.entry.path}`;
          registrant(context, instances);
        }
      }
    },
  });

  let composition: Promise<void> | undefined;
  let protectedThisKernel = false;

  const compose = (bootOptions: KernelBootOptions): Promise<void> => {
    composition ??= (async (): Promise<void> => {
      const raw = await readConfig(configPath);
      recordConfigRead(configPath, raw);
      protectConfigFile(configPath);
      protectedThisKernel = true;
      const config = parseBrudConfig(raw, configPath);
      composedConfig = config;
      const services = await loadServiceModules(config.services, configPath, raw);
      const contextOptions: Record<string, unknown> = {
        ...(options.options ?? {}),
        ...(bootOptions.options ?? {}),
      };
      const contextLogger = bootOptions.logger ?? options.logger;
      const context: KernelServiceModuleContext = {
        options: contextOptions,
        ...(contextLogger === undefined ? {} : { logger: contextLogger }),
        shared: {},
        declareContextFields,
        getContextSchema: () => contextContract.schema(),
      };

      loadedServices = services;
      serviceContext = context;

      const owned: { readonly ownerId: string; readonly service: ComposedServiceDescriptor }[] = [];

      for (const loaded of services) {
        activeServiceOwner = `${String(loaded.index)}:${loaded.entry.path}`;

        for (const descriptor of await descriptorsFromModule(
          loaded.module,
          loaded.entry,
          loaded.index,
          context,
          configPath,
          raw,
        )) {
          owned.push({
            ownerId: activeServiceOwner,
            service: {
              descriptor,
              path: loaded.entry.path,
              ...(loaded.entry.official === undefined ? {} : { official: loaded.entry.official }),
              resolvedPath: loaded.resolvedId,
              // The manifest is admitted from declared data only; the
              // participant's factory is not invoked.
              manifest: admitParticipantManifest(descriptor.token.id, descriptor.manifest),
            },
          });
        }
      }

      const composed = pruneForMissingContext(
        owned,
        contextContract,
        contextOptions,
        (participants, path, fields) => {
          const detail = { participants, path, missingFields: fields };

          (contextLogger ?? DEFAULT_KERNEL_LOGGER).warn(
            `Participant pruned before boot: required context field(s) ${fields.join(', ')} missing and nothing depends on it`,
            detail,
          );
          kernel.recordObservation('kernel.admission', 'participant-pruned', detail);
        },
      );

      // The hardcore gate runs after descriptors exist and before any service
      // is registered or initialized. A failure here never reaches the
      // service initialization phase.
      const packageHashes = verifyHardcoreServices(HARDCORE_SERVICES, composed, configPath);
      hardcorePackageHashes = packageHashes;
      hardcoreBootEntries = buildHardcoreBootEntries(composed, packageHashes);

      for (const service of composed) {
        kernel.register(service.descriptor);
      }
    })();

    return composition;
  };

  const boot = kernel.boot.bind(kernel);
  kernel.boot = async (bootOptions: KernelBootOptions): Promise<void> => {
    try {
      await compose(bootOptions);

      // Store the bag the composition built: the host's options. Service
      // modules publish no objects into it; a service-to-service handoff goes
      // through an exposed API.
      const bootBag = serviceContext?.options ?? {
        ...(options.options ?? {}),
        ...(bootOptions.options ?? {}),
      };

      await boot({
        options: bootBag,
        logger: bootOptions.logger ?? options.logger ?? DEFAULT_KERNEL_LOGGER,
      });

      // The config document is reread after boot. Refuse to hand back a kernel
      // if it changed underneath us.
      await verifyConfigIntegrity(configPath);
    } catch (error: unknown) {
      if (kernel.lifecycleState === 'RUNNING') {
        await kernel.shutdown().catch(() => undefined);
      }

      if (protectedThisKernel) {
        protectedThisKernel = false;
        releaseConfigProtection(configPath);
      }

      throw error;
    }
  };

  const shutdown = kernel.shutdown.bind(kernel);
  kernel.shutdown = async (): Promise<void> => {
    await shutdown();

    if (protectedThisKernel) {
      protectedThisKernel = false;
      releaseConfigProtection(configPath);
    }
  };

  return kernel;
}

/**
 * Applies the missing-required-field rules before boot.
 *
 * A participant whose required context fields are missing is pruned with a
 * clear reason when it is optional: it is not hardcore and nothing else in the
 * composition depends on it. A hardcore participant, or one another
 * participant depends on, refuses boot instead.
 *
 * @returns The composed descriptors that remain.
 */
function pruneForMissingContext(
  owned: readonly { readonly ownerId: string; readonly service: ComposedServiceDescriptor }[],
  contextContract: ContextContract,
  options: Readonly<Record<string, unknown>>,
  onPruned: (participants: readonly string[], path: string, fields: readonly string[]) => void,
): readonly ComposedServiceDescriptor[] {
  const missing = contextContract.missingRequiredByOwner(options);

  if (missing.size === 0) {
    return owned.map((entry) => entry.service);
  }

  const hardcoreTokens = new Set(HARDCORE_SERVICES.map((service) => service.token));
  const pruned = new Set<string>();

  for (const [ownerId, fields] of missing) {
    const services = owned.filter((entry) => entry.ownerId === ownerId);
    const tokens = new Set(services.map((entry) => entry.service.descriptor.token.id));
    const isHardcore = [...tokens].some((token) => hardcoreTokens.has(token));
    const dependedOn = owned.some((entry) =>
      entry.ownerId !== ownerId
      && entry.service.descriptor.dependencies.some((dependency) => tokens.has(dependency.id)));

    if (services.length === 0 || isHardcore || dependedOn) {
      const reason = isHardcore
        ? 'it is hardcore'
        : dependedOn
          ? 'another participant depends on it'
          : 'it declared no participant';

      throw new ContextContractError(
        `Required context field(s) ${fields.join(', ')} declared by "${ownerId}" are missing and ${reason}; boot refused.`,
        { field: fields[0], service: ownerId, actualType: 'missing' },
      );
    }

    pruned.add(ownerId);
  }

  for (const ownerId of pruned) {
    const services = owned.filter((entry) => entry.ownerId === ownerId);

    contextContract.withdraw(ownerId);
    onPruned(
      services.map((entry) => entry.service.descriptor.token.id),
      services[0]?.service.path ?? ownerId,
      missing.get(ownerId) ?? [],
    );
  }

  return owned
    .filter((entry) => !pruned.has(entry.ownerId))
    .map((entry) => entry.service);
}

function descriptorsFromModule(
  moduleValue: unknown,
  entry: BrudConfigEntry,
  index: number,
  context: KernelServiceModuleContext,
  configPath: string,
  raw: string,
): Promise<readonly ServiceDescriptor<unknown, unknown>[]> {
  return descriptorsFromModuleAsync(moduleValue, entry, index, context, configPath, raw);
}

async function descriptorsFromModuleAsync(
  moduleValue: unknown,
  entry: BrudConfigEntry,
  index: number,
  context: KernelServiceModuleContext,
  configPath: string,
  raw: string,
): Promise<readonly ServiceDescriptor<unknown, unknown>[]> {
  if (!isRecord(moduleValue) || typeof moduleValue.createService !== 'function') {
    throw new BrudConfigError(
      'MODULE_CONTRACT',
      `Service module "${entry.path}" (services[${String(index)}]) must export createService(context)`,
      configPath,
      lineOf(raw, entry.path),
    );
  }

  const createService = moduleValue.createService as (
    serviceContext: KernelServiceModuleContext,
  ) => unknown | Promise<unknown>;
  const declared: unknown = await createService(context);
  const candidates = Array.isArray(declared) ? declared : [declared];

  if (candidates.length === 0) {
    throw new BrudConfigError(
      'MODULE_CONTRACT',
      `Service module "${entry.path}" (services[${String(index)}]) exposed no service descriptor`,
      configPath,
      lineOf(raw, entry.path),
    );
  }

  for (const candidate of candidates) {
    if (!isServiceDescriptor(candidate)) {
      throw new BrudConfigError(
        'MODULE_CONTRACT',
        `Service module "${entry.path}" (services[${String(index)}]) did not return a service descriptor`,
        configPath,
        lineOf(raw, entry.path),
      );
    }
  }

  return candidates as readonly ServiceDescriptor<unknown, unknown>[];
}

async function readConfig(configPath: string): Promise<string> {
  try {
    return await readFile(configPath, 'utf8');
  } catch (error: unknown) {
    throw new BrudConfigError(
      'CONFIG_READ',
      `Cannot read config: ${error instanceof Error ? error.message : String(error)}`,
      configPath,
    );
  }
}

async function loadServiceModules(
  entries: readonly BrudConfigEntry[],
  configPath: string,
  raw: string,
): Promise<readonly LoadedService[]> {
  return Promise.all(entries.map(async (entry, index) => {
    const resolvedId = resolveModuleId(entry.path, configPath);

    return {
      index,
      entry,
      resolvedId,
      module: await importModule(
        resolvedId,
        configPath,
        entry.path,
        `services[${String(index)}]`,
        lineOf(raw, entry.path),
      ),
    };
  }));
}

async function importModule(
  id: string,
  configPath: string,
  declaredPath: string,
  label: string,
  line: number | undefined,
): Promise<unknown> {
  try {
    return await import(id.startsWith('file:') || isAbsolute(id) ? pathToFileURL(id).href : id);
  } catch (error: unknown) {
    throw new BrudConfigError(
      'MODULE_RESOLVE',
      `Cannot resolve module "${declaredPath}" (${label}): ${error instanceof Error ? error.message : String(error)}`,
      configPath,
      line,
    );
  }
}

function resolveModuleId(declaredPath: string, configPath: string): string {
  if (declaredPath.startsWith('kernel:')) {
    return resolveExisting(
      fileURLToPath(new URL(declaredPath.slice('kernel:'.length), KERNEL_PACKAGE_ROOT)),
    );
  }

  if (declaredPath.startsWith('file:')) {
    return resolveExisting(fileURLToPath(declaredPath));
  }

  if (isAbsolute(declaredPath)) {
    return resolveExisting(declaredPath);
  }

  if (declaredPath.startsWith('./') || declaredPath.startsWith('../')) {
    return resolveExisting(resolvePath(dirname(configPath), declaredPath));
  }

  return declaredPath;
}

function resolveExisting(candidate: string): string {
  if (existsSync(candidate)) {
    return candidate;
  }

  if (candidate.endsWith('.js')) {
    const source = `${candidate.slice(0, -3)}.ts`;

    if (existsSync(source)) {
      return source;
    }
  }

  if (!candidate.endsWith('.js') && !candidate.endsWith('.ts')) {
    for (const suffix of ['.js', '.ts', '/index.js', '/index.ts']) {
      const next = `${candidate}${suffix}`;

      if (existsSync(next)) {
        return next;
      }
    }
  }

  return candidate;
}

function isServiceDescriptor(value: unknown): value is ServiceDescriptor<unknown, unknown> {
  if (!isRecord(value) || !isRecord(value.token)) {
    return false;
  }

  return typeof value.token.id === 'string'
    && typeof value.factory === 'function'
    && Array.isArray(value.dependencies);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}