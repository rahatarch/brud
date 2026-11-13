import type { IServiceLifecycle, ServiceContext, ServiceTier } from '@brud/kernel';
import type { ServiceDescriptor } from '@brud/kernel';
import { CORE_API_NAME, withExposedApis } from '@brud/kernel';
import type { IConfigStore } from '../contracts/IConfigStore.js';
import type {
  ISettingsReader,
  ISettingsService,
  SettingsSnapshot,
  SettingsWarning,
} from '../contracts/ISettingsService.js';
import {
  SettingsService,
  createSettingsReader,
} from '../orchestrator/SettingsService.js';
import { ConfigStore } from '../storage/ConfigStore.js';
import { requireContextString } from '@brud/kernel';
import { SettingsReaderToken, SettingsToken } from './tokens.js';

/** Namespace owned by the settings service in the context contract. */
export const SETTINGS_CONTEXT_SCOPE = 'settings';

/** Namespaced context field holding the workspace root. */
export const SETTINGS_ROOT_CONTEXT_FIELD = 'settings.root';

/** Tier assigned to the settings descriptors. */
export const SETTINGS_SERVICE_TIER: ServiceTier = 'core';

/**
 * Callers allowed to resolve the mutating service token.
 *
 * Userland and plugin callers must resolve {@link SettingsReaderToken}
 * instead. The access broker enforces this list before any projection runs.
 */
export const SETTINGS_MUTATOR_CALLERS: readonly string[] = Object.freeze([
  'kernel',
  'brud.host.daemon',
  'brud.host.desktop',
]);

/** Configuration for {@link createSettingsDescriptor}. */
export interface SettingsDescriptorOptions {
  /** Pre-built scope-gated store. Defaults to a filesystem {@link ConfigStore}. */
  readonly store?: IConfigStore;

  /** Home directory used when constructing the default store. */
  readonly homeDirectory?: string;

  /** Base policy override. Intended for tests and alternate hosts. */
  readonly defaults?: SettingsSnapshot;

  /** Optional sink for structured warnings. */
  readonly onWarning?: (warning: SettingsWarning) => void;
}

/**
 * Builds the settings service descriptor.
 *
 * The descriptor has no dependencies so it boots first in the standard
 * kernel. `accessPolicy` restricts the mutating token to the kernel and the
 * trusted hosts. `project` still degrades a userland caller to a
 * mutation-free reader as defence in depth.
 *
 * @param options - Optional store, defaults, and warning overrides.
 * @returns A core-tier descriptor for `brud.core.settings`.
 */
export function createSettingsDescriptor(
  options?: SettingsDescriptorOptions,
): ServiceDescriptor<ISettingsService, SettingsService> {
  return {
    token: SettingsToken,
    tier: SETTINGS_SERVICE_TIER,
    dependencies: [],
    accessPolicy: {
      allowedCallers: [...SETTINGS_MUTATOR_CALLERS],
    },
    factory: (context: ServiceContext): SettingsService => {
      const store = options?.store ?? new ConfigStore({
        workspaceRoot: requireContextString(
          context.options,
          SETTINGS_ROOT_CONTEXT_FIELD,
          SettingsToken.id,
        ),
        ...(options?.homeDirectory === undefined ? {} : { homeDirectory: options.homeDirectory }),
      });

      const service = new SettingsService({
        store,
        ...(options?.defaults === undefined ? {} : { defaults: options.defaults }),
        ...(options?.onWarning === undefined ? {} : { onWarning: options.onWarning }),
      });

      return withExposedApis(service, (registry) => {
        registry.registerApi(CORE_API_NAME.settings, SettingsToken, {
          capability: 'settings:write',
          scope: 'runtime',
        });
      });
    },
    project: (instance: SettingsService, caller: ServiceContext): ISettingsService => {
      if (caller.tier === 'userland') {
        const reader: ISettingsReader = createSettingsReader(instance);

        // The token carries the host contract; the projection is the runtime
        // capability boundary and deliberately omits `update`/`reload`.
        return reader as unknown as ISettingsService;
      }

      return instance;
    },
  };
}

/**
 * Builds the read-only reader descriptor.
 *
 * The reader token carries no access policy, so every caller may resolve it.
 * The kernel guarantees the settings instance is initialized first through the
 * declared dependency, and resolution is deferred until the first use because
 * the access broker only serves requests while the kernel is `RUNNING`.
 *
 * @returns A core-tier descriptor for `brud.core.settings.reader`.
 */
export function createSettingsReaderDescriptor(): ServiceDescriptor<ISettingsReader> {
  return {
    token: SettingsReaderToken,
    tier: SETTINGS_SERVICE_TIER,
    dependencies: [SettingsToken],
    factory: (context: ServiceContext, broker) => {
      let resolved: ISettingsReader | undefined;

      const resolve = (): ISettingsReader => {
        resolved ??= broker.requestAccess(
          {
            callerId: 'kernel',
            tier: 'kernel',
            options: context.options,
          },
          SettingsToken,
        );

        return resolved;
      };

      const reader: ISettingsReader & IServiceLifecycle = {
        getSnapshot: (): SettingsSnapshot => resolve().getSnapshot(),
        onChange: (listener: (snapshot: SettingsSnapshot) => void): (() => void) =>
          resolve().onChange(listener),
        initialize: async (): Promise<void> => undefined,
        dispose: async (): Promise<void> => undefined,
      };

      return withExposedApis(reader, (registry) => {
        registry.registerApi(CORE_API_NAME.settingsReader, SettingsReaderToken, {
          capability: 'settings:read',
          scope: 'runtime',
        });
      });
    },
  };
}
