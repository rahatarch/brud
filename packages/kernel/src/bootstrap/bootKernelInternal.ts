import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ServiceDescriptor } from '../contracts/serviceDescriptor.js';
import {
  ContextContract,
  type ContextFieldDeclaration,
  type ContextScopeDeclaration,
} from '../contracts/contextContract.js';
import type { KernelLogger, IServiceLifecycle } from '../contracts/lifecycle.js';
import type { KernelBootOptions } from '../contracts/kernel.js';
import { BrudKernel } from '../engine/BrudKernel.js';
import {
  protectConfigFile,
  recordConfigRead,
  releaseConfigProtection,
  verifyConfigIntegrity,
} from './config/integrity.js';
import { parseBrudConfig } from './config/parse.js';
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
  KernelPlugin,
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

interface LoadedPlugin {
  readonly index: number;
  readonly entry: BrudConfigEntry;
  readonly module: unknown;
}

interface ResolvedPlugins {
  readonly plugins: readonly KernelPlugin[] | undefined;
  readonly officialPlugins: readonly KernelPlugin[];
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
 * The public `createStandardKernel` wrapper is synchronous; deferring module
 * imports until boot keeps module instances in the ESM cache instead of
 * loading a second copy through `require`.
 */
export function createDeferredKernel(
  configPath: string,
  options: ComposeKernelOptions,
): BrudKernel {
  let loadedServices: readonly LoadedService[] = [];
  let serviceContext: KernelServiceModuleContext | undefined;
  let hardcoreBootEntries: readonly HardcoreBootEntry[] = [];
  let hardcorePackageHashes: ReadonlyMap<string, string> = new Map();
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
    bootHardcore: (instances): void => {
      invokeHardcoreBootHooks(
        HARDCORE_SERVICES,
        instances,
        hardcorePackageHashes,
        hardcoreBootEntries,
      );
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
      const services = await loadServiceModules(config.services, configPath, raw);
      const mergedOptions: Record<string, unknown> = {
        ...(options.options ?? {}),
        ...(bootOptions.options ?? {}),
      };
      const resolvedPlugins = await resolvePlugins(configPath, raw, mergedOptions);
      const contextOptions = withResolvedPlugins(mergedOptions, resolvedPlugins);
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

      const composed: ComposedServiceDescriptor[] = [];

      for (const loaded of services) {
        activeServiceOwner = `${String(loaded.index)}:${loaded.entry.path}`;
        composed.push({
          descriptor: descriptorFromModule(
            loaded.module,
            loaded.entry,
            loaded.index,
            context,
            configPath,
            raw,
          ),
          path: loaded.entry.path,
          official: loaded.entry.official === true,
          resolvedPath: loaded.resolvedId,
        });
      }

      // The hardcore gate runs after descriptors exist and before any service
      // is registered or initialized. A failure here never reaches the
      // service initialization phase.
      const packageHashes = verifyHardcoreServices(HARDCORE_SERVICES, composed, configPath);
      hardcorePackageHashes = packageHashes;
      hardcoreBootEntries = buildHardcoreBootEntries(composed, packageHashes);

      for (const service of composed) {
        const descriptorToRegister: ServiceDescriptor<unknown, unknown> =
          service.official
            ? { ...service.descriptor, official: true }
            : service.descriptor;

        kernel.register(descriptorToRegister);
      }
    })();

    return composition;
  };

  const boot = kernel.boot.bind(kernel);
  kernel.boot = async (bootOptions: KernelBootOptions): Promise<void> => {
    try {
      await compose(bootOptions);

      // Compose enriched the bag during service construction (the filesystem
      // module publishes its driver and journal there). Store that exact bag so
      // runtime contexts see the same object the service modules saw.
      const bootBag = serviceContext?.options ?? {
        ...(options.options ?? {}),
        ...(bootOptions.options ?? {}),
      };

      await boot({
        options: bootBag,
        logger: bootOptions.logger ?? options.logger ?? DEFAULT_KERNEL_LOGGER,
      });

      // Plugins activate during boot. Re-read the document the kernel actually
      // used and refuse to hand back a kernel if it changed underneath us.
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

function withResolvedPlugins(
  options: Record<string, unknown>,
  resolved: ResolvedPlugins,
): Record<string, unknown> {
  return {
    ...options,
    ...(resolved.plugins === undefined ? {} : { plugins: resolved.plugins }),
    officialPlugins: resolved.officialPlugins,
  };
}

async function resolvePlugins(
  configPath: string,
  raw: string,
  options: Record<string, unknown>,
): Promise<ResolvedPlugins> {
  const override = options['plugins'];

  if (override !== undefined) {
    const plugins = Array.isArray(override) ? override as readonly KernelPlugin[] : [];

    return {
      plugins,
      officialPlugins: options['certifyPlugins'] === true ? plugins : [],
    };
  }

  const config = parseBrudConfig(raw, configPath);
  const loaded = await loadPluginModules(config.plugins, configPath, raw);

  if (loaded.length === 0) {
    return { plugins: undefined, officialPlugins: [] };
  }

  const plugins: KernelPlugin[] = [];
  const officialPlugins: KernelPlugin[] = [];

  for (const entry of loaded) {
    const plugin = extractPlugin(entry.module);

    if (plugin === undefined) {
      throw new BrudConfigError(
        'MODULE_CONTRACT',
        `Plugin module "${entry.entry.path}" (plugins[${String(entry.index)}]) must export a plugin`,
        configPath,
        lineOf(raw, entry.entry.path),
      );
    }

    plugins.push(plugin);

    if (entry.entry.official === true) {
      officialPlugins.push(plugin);
    }
  }

  return { plugins, officialPlugins };
}

function descriptorFromModule(
  moduleValue: unknown,
  entry: BrudConfigEntry,
  index: number,
  context: KernelServiceModuleContext,
  configPath: string,
  raw: string,
): ServiceDescriptor<unknown, unknown> {
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
  ) => unknown;
  const descriptor: unknown = createService(context);

  if (!isServiceDescriptor(descriptor)) {
    throw new BrudConfigError(
      'MODULE_CONTRACT',
      `Service module "${entry.path}" (services[${String(index)}]) did not return a service descriptor`,
      configPath,
      lineOf(raw, entry.path),
    );
  }

  return descriptor;
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

async function loadPluginModules(
  entries: readonly BrudConfigEntry[],
  configPath: string,
  raw: string,
): Promise<readonly LoadedPlugin[]> {
  return Promise.all(entries.map(async (entry, index) => ({
    index,
    entry,
    module: await importModule(
      resolveModuleId(entry.path, configPath),
      configPath,
      entry.path,
      `plugins[${String(index)}]`,
      lineOf(raw, entry.path),
    ),
  })));
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

function extractPlugin(moduleValue: unknown): KernelPlugin | undefined {
  if (!isRecord(moduleValue)) {
    return undefined;
  }

  if (isPlugin(moduleValue.default)) {
    return moduleValue.default;
  }

  if (isPlugin(moduleValue.plugin)) {
    return moduleValue.plugin;
  }

  const candidates = Object.values(moduleValue).filter(isPlugin);

  return candidates.length === 1 ? candidates[0] : undefined;
}

function isPlugin(value: unknown): value is KernelPlugin {
  return isRecord(value) && isRecord(value.manifest) && typeof value.activate === 'function';
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

function lineOf(raw: string, token: string): number | undefined {
  const needle = JSON.stringify(token);
  const index = raw.split('\n').findIndex((line) => line.includes(needle));

  return index < 0 ? undefined : index + 1;
}