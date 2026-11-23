import { createCapabilitySet } from '../contracts/capabilitySet.js';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative as relativePath, resolve as resolvePath } from 'node:path';
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
import { LifecycleStateError } from '../engine/errors.js';
import { checkSeal } from './seal.js';
import { abandonment, culpritOf, LoadedParticipantFailure, type AbandonedParticipant } from './loaded.js';
import { KernelReloadError, refuseFrozenChange, type ReloadableKernel, type ReloadOptions } from './reload.js';
import {
  acceptConfigChange,
  protectConfigFile,
  recordConfigRead,
  releaseConfigProtection,
  verifyConfigIntegrity,
} from './config/integrity.js';
import { lineOf, parseBrudConfig } from './config/parse.js';
import { PackageRequirementsError, readPackageRequirements } from './packageRequirements.js';
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
): Promise<ReloadableKernel> {
  return startTolerant(configPath, options, {
    ...(options.options === undefined ? {} : { options: options.options }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  }, undefined);
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
): ReloadableKernel {
  return assembleKernel(configPath, options, undefined).kernel;
}

/**
 * Boots a kernel, leaving out loaded participants that cannot start.
 *
 * A loaded participant is any config entry not declared official. One that
 * fails to load, to be admitted, or to start is left out and the boot is tried
 * again without it, so a bad loaded participant never stops the kernel. A
 * failure in a hardcore or composed participant still refuses the boot.
 *
 * A failure while composing names its loaded participants itself. A failure
 * while booting is traced to the participant it names, or to the service that
 * threw it. When it cannot be traced to a loaded participant, every loaded
 * participant is left out once and the boot is tried again; if that fails
 * too, the failure was in the build and is thrown.
 *
 * @param baseline - The booted config this one replaces, for a reload.
 * @param beforeFirstBoot - Runs once, after the new composition is checked and
 *   before anything boots: a reload stops the running kernel here.
 * @param wrap - Turns a failure after `beforeFirstBoot` into the error thrown.
 */
async function startTolerant(
  configPath: string,
  options: ComposeKernelOptions,
  bootOptions: KernelBootOptions,
  baseline: BrudConfig | undefined,
  beforeFirstBoot?: () => Promise<void>,
  wrap?: (error: unknown) => unknown,
): Promise<ReloadableKernel> {
  const left = new Map<string, AbandonedParticipant>();
  let stopped = false;
  let sweptAll = false;

  for (;;) {
    const attempt = assembleKernel(configPath, options, baseline, new Set(left.keys()));
    let phase: 'compose' | 'boot' = 'compose';

    try {
      await attempt.validate(bootOptions);

      if (!stopped) {
        stopped = true;

        try {
          await beforeFirstBoot?.();
        } catch (error: unknown) {
          attempt.abandon();

          throw error;
        }
      }

      phase = 'boot';
      await attempt.kernel.boot(bootOptions);
    } catch (error: unknown) {
      const fresh = blamedLoaded(attempt, error, phase, left, sweptAll);

      if (fresh === undefined) {
        throw stopped && wrap !== undefined ? wrap(error) : error;
      }

      sweptAll ||= fresh.swept;

      for (const entry of fresh.entries) {
        left.set(entry.path, entry);
      }

      continue;
    }

    attempt.setAbandoned([...left.values()]);
    reportAbandoned(bootOptions.logger ?? options.logger ?? DEFAULT_KERNEL_LOGGER, left);

    return attempt.kernel;
  }
}

/** The loaded participants to leave out after a failed attempt, or `undefined` when the failure is not theirs. */
function blamedLoaded(
  attempt: AssembledKernel,
  error: unknown,
  phase: 'compose' | 'boot',
  left: ReadonlyMap<string, AbandonedParticipant>,
  sweptAll: boolean,
): { readonly entries: readonly AbandonedParticipant[]; readonly swept: boolean } | undefined {
  if (error instanceof LoadedParticipantFailure) {
    const entries = error.participants.filter((entry) => !left.has(entry.path));

    return entries.length === 0 ? undefined : { entries, swept: false };
  }

  if (phase === 'compose') {
    return undefined;
  }

  const token = culpritOf(error);
  const path = token === undefined ? undefined : attempt.loadedPathOf(token);

  if (path !== undefined && !left.has(path)) {
    return { entries: [abandonment(path, error, token)], swept: false };
  }

  if (sweptAll) {
    return undefined;
  }

  const remaining = attempt.config().services.filter((entry) => entry.official !== true && !left.has(entry.path));

  if (remaining.length === 0) {
    return undefined;
  }

  const why = error instanceof Error ? error.message : String(error);

  return {
    swept: true,
    entries: remaining.map((entry): AbandonedParticipant => ({
      path: entry.path,
      reason: `the kernel could not start with the loaded participants and the cause could not be traced to one of them (${why})`,
    })),
  };
}

function reportAbandoned(logger: KernelLogger, left: ReadonlyMap<string, AbandonedParticipant>): void {
  if (left.size === 0) {
    return;
  }

  const lines = [...left.values()].map((entry) => `${entry.path}: ${entry.reason}`);

  logger.warn(`Left out ${String(left.size)} loaded participant(s); the kernel started without them:\n${lines.join('\n')}`, {
    abandoned: [...left.values()],
  });
}

/** A kernel being assembled, with the steps a reload runs on it before the old kernel stops. */
interface AssembledKernel {
  readonly kernel: ReloadableKernel;
  /** Reads, checks and composes the config without starting anything. */
  validate(bootOptions: KernelBootOptions): Promise<void>;
  /** Releases the config protection of a kernel that will never boot. */
  abandon(): void;
  /** The config this kernel read, once it has read it. */
  config(): BrudConfig;
  /** The config path of the loaded participant that owns a service token. */
  loadedPathOf(token: string): string | undefined;
  /** Records which loaded participants were left out, for the host to read. */
  setAbandoned(list: readonly AbandonedParticipant[]): void;
}

/**
 * Builds a kernel and the handles a reload needs.
 *
 * @param baseline - The booted config this one replaces, when it is a reload's
 *   successor: its read supersedes the recorded config digest, and its frozen
 *   part must match the baseline.
 */
function assembleKernel(
  configPath: string,
  options: ComposeKernelOptions,
  baseline: BrudConfig | undefined,
  skip: ReadonlySet<string> = new Set(),
): AssembledKernel {
  let lastBootOptions: KernelBootOptions = {};
  let abandonedList: readonly AbandonedParticipant[] = [];
  const loadedTokens = new Map<string, string>();
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
          capabilities: createCapabilitySet(entry.manifest.capabilities),
          ...(entry.parentIdentity === undefined
            ? {}
            : { parentIdentity: entry.parentIdentity }),
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
  }) as ReloadableKernel;

  let composition: Promise<void> | undefined;
  let protectedThisKernel = false;

  const compose = (bootOptions: KernelBootOptions): Promise<void> => {
    composition ??= (async (): Promise<void> => {
      const raw = await readConfig(configPath);
      const config = parseBrudConfig(raw, configPath);

      // With a build seal, the official participants must be exactly those the
      // builder sealed. One that declares itself official without being sealed
      // is not part of the build, so it is left out and named.
      const sealCheck = options.seal === undefined ? undefined : checkSeal(options.seal, config, configPath);

      if (baseline !== undefined) {
        refuseFrozenChange(baseline, config, configPath, sealCheck?.sealed);
        acceptConfigChange(configPath);
      }

      const unsealed = sealCheck?.unsealed ?? new Set<string>();
      const newlyUnsealed = [...unsealed].filter((path) => !skip.has(path));

      if (newlyUnsealed.length > 0) {
        throw new LoadedParticipantFailure(newlyUnsealed.map((path): AbandonedParticipant => ({
          path,
          code: 'PARTICIPANT_NOT_SEALED',
          reason: 'it declares itself official, but the build did not seal it; only a rebuild can make a participant official',
        })));
      }

      recordConfigRead(configPath, raw);
      protectConfigFile(configPath);
      protectedThisKernel = true;
      composedConfig = config;
      const services = await loadServiceModules(config.services.filter((entry) => !(skip.has(entry.path) && (entry.official !== true || unsealed.has(entry.path)))), configPath, raw);
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

      const failedLoaded: AbandonedParticipant[] = [];

      for (const loaded of services) {
        activeServiceOwner = `${String(loaded.index)}:${loaded.entry.path}`;

        try {
          const own: { readonly ownerId: string; readonly service: ComposedServiceDescriptor }[] = [];

          for (const descriptor of await descriptorsFromModule(
            loaded.module,
            loaded.entry,
            loaded.index,
            context,
            configPath,
            raw,
          )) {
            own.push({
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

          owned.push(...own);
        } catch (error: unknown) {
          if (loaded.entry.official === true) {
            throw error;
          }

          failedLoaded.push(abandonment(loaded.entry.path, error));
        }
      }

      if (failedLoaded.length > 0) {
        throw new LoadedParticipantFailure(failedLoaded);
      }

      // A loaded participant that lacks a required boot option is left out. If
      // any hardcore or composed participant lacks one, the boot is refused as
      // before, naming every missing field.
      contextContract.assertNamespaced(contextOptions);
      const missing = contextContract.missingRequiredByOwner(contextOptions);
      const pathOf = (ownerId: string): string => ownerId.slice(ownerId.indexOf(':') + 1);
      const loadedPaths = new Set(owned.filter((entry) => entry.service.official !== true).map((entry) => entry.service.path));

      if (missing.size > 0 && [...missing.keys()].every((ownerId) => loadedPaths.has(pathOf(ownerId)))) {
        throw new LoadedParticipantFailure([...missing].map(([ownerId, fields]): AbandonedParticipant => ({
          path: pathOf(ownerId),
          code: 'CONTEXT_FIELD_MISSING',
          reason: `required boot option(s) not supplied: ${fields.join(', ')}`,
        })));
      }

      const composed = refuseMissingContext(owned, contextContract, contextOptions);

      for (const entry of owned) {
        if (entry.service.official !== true) {
          loadedTokens.set(entry.service.descriptor.token.id, entry.service.path);
        }
      }

      // The hardcore gate runs after descriptors exist and before any service
      // is registered or initialized. A failure here never reaches the
      // service initialization phase.
      const packageHashes = verifyHardcoreServices(HARDCORE_SERVICES, composed, configPath);
      hardcorePackageHashes = packageHashes;
      hardcoreBootEntries = buildHardcoreBootEntries(composed, packageHashes, HARDCORE_SERVICES);

      for (const service of composed) {
        kernel.register(service.descriptor);
      }
    })();

    return composition;
  };

  const boot = kernel.boot.bind(kernel);
  kernel.boot = async (bootOptions: KernelBootOptions): Promise<void> => {
    lastBootOptions = bootOptions;

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

  const abandon = (): void => {
    if (protectedThisKernel) {
      protectedThisKernel = false;
      releaseConfigProtection(configPath);
    }
  };

  const validate = async (bootOptions: KernelBootOptions): Promise<void> => {
    try {
      await compose(bootOptions);
    } catch (error: unknown) {
      abandon();

      throw error;
    }
  };

  kernel.reload = (reloadOptions: ReloadOptions = {}): Promise<ReloadableKernel> => {
    if (kernel.lifecycleState !== 'RUNNING') {
      return Promise.reject(new LifecycleStateError('reload', kernel.lifecycleState, 'RUNNING'));
    }

    const target = reloadOptions.configPath ?? configPath;

    // The new composition is read, checked against the frozen part and
    // composed while this kernel still runs; a refusal changes nothing. Only
    // then is this kernel stopped and the new one booted.
    return startTolerant(
      target,
      options,
      lastBootOptions,
      composedConfig,
      () => kernel.shutdown(),
      (error) => new KernelReloadError(target, error),
    );
  };

  Object.defineProperty(kernel, 'abandoned', { get: () => abandonedList, enumerable: true });

  return {
    kernel,
    validate,
    abandon,
    config: () => composedConfig,
    loadedPathOf: (token) => loadedTokens.get(token),
    setAbandoned: (list) => {
      abandonedList = list;
    },
  };
}

/**
 * Refuses the boot when any required context field is missing.
 *
 * The rule is the same for every participant, official or not, hardcore or
 * not, depended on or not: a participant that declared a field as required
 * cannot run without it, and leaving it out would give a composition whose
 * exposures disappear without a reason. The error names every missing field,
 * the declaring owner, the participants it covers and the module path, so one
 * failed boot tells the host everything it must supply.
 *
 * @returns The composed descriptors, unchanged.
 */
function refuseMissingContext(
  owned: readonly { readonly ownerId: string; readonly service: ComposedServiceDescriptor }[],
  contextContract: ContextContract,
  options: Readonly<Record<string, unknown>>,
): readonly ComposedServiceDescriptor[] {
  // A value in the wrong shape or under a flat alias is reported as that, before
  // the field it was meant for is reported as missing.
  contextContract.assertNamespaced(options);

  const missing = contextContract.missingRequiredByOwner(options);

  if (missing.size > 0) {
    const scopeOf = new Map(contextContract.schema().fields.map((field) => [field.name, field.service]));
    const parts = [...missing].map(([ownerId, fields]) => {
      const services = owned.filter((entry) => entry.ownerId === ownerId);
      const participants = services.map((entry) => entry.service.descriptor.token.id);
      const path = services[0]?.service.path;

      return `${fields.join(', ')} (scope "${scopeOf.get(fields[0] ?? '') ?? ownerId}"${participants.length === 0 ? '' : `, participant ${participants.join(', ')}`}${path === undefined ? '' : `, module ${path}`})`;
    });
    const first = [...missing][0] as [string, readonly string[]];

    throw new ContextContractError(
      `Boot refused: required context field(s) missing: ${parts.join('; ')}. Supply them in the boot options.`,
      { field: first[1][0], service: first[0], actualType: 'missing' },
    );
  }

  return owned.map((entry) => entry.service);
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

/** A loader a hardcore service module exports for participant packages (W-01). */
type ParticipantPackageLoader = (manifestPath: string) => Promise<unknown>;

const isParticipantPackage = (id: string): boolean => id.endsWith('.json');

/** Reads the optional `native` entry of a participant package declared official. */
function packageRequirementsOf(
  manifestPath: string,
  declaredPath: string,
  configPath: string,
  label: string,
  line: number | undefined,
): ReturnType<typeof readPackageRequirements> {
  try {
    return readPackageRequirements(manifestPath);
  } catch (error: unknown) {
    const reason = error instanceof PackageRequirementsError ? error.message : String(error);

    throw new BrudConfigError('MODULE_RESOLVE', `Cannot read participant package "${declaredPath}" (${label}): ${reason}`, configPath, line);
  }
}

function nativeEntryOf(manifestPath: string, configPath: string, label: string, line: number | undefined): string | undefined {
  let pkg: unknown;

  try {
    pkg = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
  } catch (error: unknown) {
    throw new BrudConfigError('MODULE_RESOLVE', `Cannot read participant package "${manifestPath}" (${label}): ${error instanceof Error ? error.message : String(error)}`, configPath, line);
  }

  const native = (pkg as { native?: unknown } | null)?.native;

  if (native === undefined) {
    return undefined;
  }

  const resolvedNative = resolvePath(dirname(manifestPath), String(native));
  const inside = relativePath(dirname(manifestPath), resolvedNative);

  if (typeof native !== 'string' || inside.startsWith('..') || isAbsolute(inside)) {
    throw new BrudConfigError('MODULE_RESOLVE', `Participant package "${manifestPath}" (${label}): native must be a path inside the package`, configPath, line);
  }

  return resolvedNative;
}

/**
 * Loads every composition entry, enforcing the tier rule (W-01): an entry
 * declared `official: true` runs as Node; every other entry must be a
 * participant package, loaded by the package loader a hardcore provides, so
 * none of its author code runs as Node. A non-official native module is
 * refused at boot.
 */
async function loadServiceModules(
  entries: readonly BrudConfigEntry[],
  configPath: string,
  raw: string,
): Promise<readonly LoadedService[]> {
  const unresolvable: AbandonedParticipant[] = [];
  const resolved = entries.flatMap((entry, index) => {
    try {
      return [{
        index,
        entry,
        resolvedId: resolveModuleId(entry.path, configPath),
        label: `services[${String(index)}]`,
        line: lineOf(raw, entry.path),
      }];
    } catch (error: unknown) {
      // A loaded participant whose path does not resolve is left out; the same
      // failure in a hardcore or composed entry refuses the boot.
      if (entry.official === true) {
        throw error;
      }

      unresolvable.push(abandonment(entry.path, error));

      return [];
    }
  });
  const official = new Map<number, unknown>();

  await Promise.all(resolved.map(async (item) => {
    if (item.entry.official === true && !isParticipantPackage(item.resolvedId)) {
      official.set(item.index, await importModule(item.resolvedId, configPath, item.entry.path, item.label, item.line));
    }
  }));

  const loaders = [...official.values()].flatMap((module) => {
    const loader = (module as { loadParticipantPackage?: unknown } | null)?.loadParticipantPackage;

    return typeof loader === 'function' ? [loader as ParticipantPackageLoader] : [];
  });

  const outcomes = await Promise.allSettled(resolved.map(async (item) => {
    const { index, entry, resolvedId, label, line } = item;

    if (official.has(index)) {
      return { index, entry, resolvedId, module: official.get(index) };
    }

    if (!isParticipantPackage(resolvedId)) {
      throw new BrudConfigError(
        'PARTICIPANT_TIER',
        `"${entry.path}" (${label}) is not declared official, so it cannot run as native code (W-01): ship it as a participant package (brud.participant.json) or declare it "official": true`,
        configPath,
        line,
      );
    }

    const requirements = packageRequirementsOf(resolvedId, entry.path, configPath, label, line);

    if (requirements.official && entry.official !== true) {
      const needs = requirements.powers.length === 0 ? '' : ` It uses: ${requirements.powers.join(', ')}.`;

      throw new BrudConfigError(
        'PARTICIPANT_REQUIRES_OFFICIAL',
        `"${entry.path}" (${label}) requires the composition to declare it "official": true, because it cannot run caged.${needs} Declare it official to run it as trusted native code, or remove the entry`,
        configPath,
        line,
      );
    }

    if (entry.official === true) {
      const native = nativeEntryOf(resolvedId, configPath, label, line);

      if (native !== undefined) {
        return { index, entry, resolvedId, module: await importModule(native, configPath, entry.path, label, line) };
      }
    }

    const loader = loaders.length === 1 ? loaders[0] : undefined;

    if (loader === undefined) {
      throw new BrudConfigError(
        'PARTICIPANT_TIER',
        `"${entry.path}" (${label}) is a participant package, but the composition provides ${loaders.length === 0 ? 'no' : 'more than one'} participant package loader`,
        configPath,
        line,
      );
    }

    try {
      return { index, entry, resolvedId, module: await loader(resolvedId) };
    } catch (error: unknown) {
      throw new BrudConfigError(
        'MODULE_RESOLVE',
        `Cannot load participant package "${entry.path}" (${label}): ${error instanceof Error ? error.message : String(error)}`,
        configPath,
        line,
      );
    }
  }));

  const loaded: LoadedService[] = [];
  const left: AbandonedParticipant[] = [...unresolvable];

  for (const [position, outcome] of outcomes.entries()) {
    if (outcome.status === 'fulfilled') {
      loaded.push(outcome.value);
      continue;
    }

    const entry = (resolved[position] as (typeof resolved)[number]).entry;

    if (entry.official === true) {
      throw outcome.reason;
    }

    left.push(abandonment(entry.path, outcome.reason));
  }

  if (left.length > 0) {
    throw new LoadedParticipantFailure(left);
  }

  return loaded;
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

export function resolveModuleId(declaredPath: string, configPath: string): string {
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