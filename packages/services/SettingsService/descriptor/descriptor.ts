import type { ServiceDescriptor, ServiceTier } from '@brud/kernel';
import { byCapability, defineParticipant, type Surface } from '@brud/sdk/participant';
import {
  SETTINGS_EXPOSURE,
  SETTINGS_READER_EXPOSURE,
  SETTINGS_READ_CAPABILITY,
  SETTINGS_WRITE_CAPABILITY,
  type ISettingsReaderApi,
} from '../contracts/exposure.js';
import { DEFAULT_SETTINGS } from '../model/defaults.js';
import type { IConfigStore } from '../contracts/IConfigStore.js';
import type {
  ConfigScope,
  ISettingsReader,
  ISettingsService,
  SettingsSnapshot,
  SettingsWarning,
} from '../contracts/ISettingsService.js';
import { SettingsService } from '../orchestrator/SettingsService.js';
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

/** Read surface shared by both capabilities of `brud.settings`. */
const readSurface: Surface<SettingsService> = (ctx) => ({
  getSnapshot: () => ctx.instance.getSnapshot(),
  onChange: (listener: (snapshot: SettingsSnapshot) => void) => ctx.instance.onChange(listener),
});

/**
 * Builds the `brud.core.settings` descriptor with the BrudOS SDK: one exposure,
 * `brud.settings@1`. `settings:read` gets `getSnapshot`/`onChange`;
 * `settings:write` adds `update`/`reload`; callers with neither get `null`
 * (open read access is `brud.settings.reader`).
 *
 */
export function createSettingsDescriptor(
  options?: SettingsDescriptorOptions,
): ServiceDescriptor<ISettingsService, SettingsService> {
  return defineParticipant<SettingsService>({
    id: SettingsToken.id,
    description: SettingsToken.description,
    tier: SETTINGS_SERVICE_TIER,
    exposes: {
      [SETTINGS_EXPOSURE]: {
        version: 1,
        scope: 'runtime',
        policy: { policyVersion: 2, capabilities: [SETTINGS_READ_CAPABILITY] },
        handle: byCapability<SettingsService>({
          [SETTINGS_READ_CAPABILITY]: readSurface,
          [SETTINGS_WRITE_CAPABILITY]: (ctx, caller) => ({
            ...readSurface(ctx, caller),
            reload: () => ctx.instance.reload(),
            update: (scope: ConfigScope, patch: Partial<SettingsSnapshot>) => ctx.instance.update(scope, patch),
          }),
        }),
      },
    },
    create: (ctx) => {
      const store = options?.store ?? new ConfigStore({
        workspaceRoot: requireContextString(
          ctx.bootOptions,
          SETTINGS_ROOT_CONTEXT_FIELD,
          SettingsToken.id,
        ),
        ...(options?.homeDirectory === undefined ? {} : { homeDirectory: options.homeDirectory }),
      });

      return new SettingsService({
        store,
        ...(options?.defaults === undefined ? {} : { defaults: options.defaults }),
        ...(options?.onWarning === undefined ? {} : { onWarning: options.onWarning }),
      });
    },
  })() as unknown as ServiceDescriptor<ISettingsService, SettingsService>;
}

/**
 * Builds the `brud.core.settings.reader` descriptor: one exposure,
 * `brud.settings.reader@1`, open to every caller. It reads through
 * `ctx.resolve('brud.settings')` at call time; until that resolves it serves
 * the defaults and a no-op subscription.
 */
export function createSettingsReaderDescriptor(): ServiceDescriptor<ISettingsReader> {
  return defineParticipant<ISettingsReaderApi>({
    id: SettingsReaderToken.id,
    description: SettingsReaderToken.description,
    tier: SETTINGS_SERVICE_TIER,
    requests: [SETTINGS_READ_CAPABILITY],
    exposes: {
      [SETTINGS_READER_EXPOSURE]: {
        version: 1,
        // Open read: admits host-rooted chains so kind owners (e.g. the tool
        // allow-list) can read settings while serving a routed request.
        scope: 'any',
        handle: (_caller, ctx): ISettingsReaderApi => ctx.instance,
      },
    },
    create: (ctx) => {
      const source = (): ISettingsReaderApi | null => ctx.resolve<ISettingsReaderApi>(SETTINGS_EXPOSURE);

      return {
        getSnapshot: (): SettingsSnapshot => source()?.getSnapshot() ?? DEFAULT_SETTINGS,
        onChange: (listener: (snapshot: SettingsSnapshot) => void): (() => void) =>
          source()?.onChange(listener) ?? ((): void => undefined),
      };
    },
  })() as unknown as ServiceDescriptor<ISettingsReader>;
}
