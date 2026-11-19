import type { ServiceContext, ServiceDescriptor, ServiceTier } from '@brud/kernel';
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
/** Read surface shared by both capabilities of `brud.settings`. */
const readSurface: Surface<SettingsService> = (ctx) => ({
  getSnapshot: () => ctx.instance.getSnapshot(),
  onChange: (listener: (snapshot: SettingsSnapshot) => void) => ctx.instance.onChange(listener),
});

/**
 * Builds the `brud.core.settings` descriptor with the BrudOS SDK: one exposure,
 * `brud.settings@1`. `settings:read` gets `getSnapshot`/`onChange`;
 * `settings:write` adds `update`/`reload`; callers with neither get `null`
 * (open read access is `brud.settings.reader`). The token-level `accessPolicy`
 * is kept for hosts that still take the token directly.
 *
 * `create` does not receive the boot `ServiceContext` (SDK gap), so the factory
 * is wrapped to capture it for the `settings.root` context field.
 */
export function createSettingsDescriptor(
  options?: SettingsDescriptorOptions,
): ServiceDescriptor<ISettingsService, SettingsService> {
  let bootContext: ServiceContext | undefined;

  const base = defineParticipant<SettingsService>({
    id: SettingsToken.id,
    description: SettingsToken.description,
    tier: SETTINGS_SERVICE_TIER,
    exposes: {
      [SETTINGS_EXPOSURE]: {
        version: 1,
        scope: 'runtime',
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
    create: () => {
      const store = options?.store ?? new ConfigStore({
        workspaceRoot: requireContextString(
          bootContext?.options ?? {},
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
  })();

  return {
    ...base,
    token: SettingsToken,
    accessPolicy: { allowedCallers: [...SETTINGS_MUTATOR_CALLERS] },
    factory: (context: ServiceContext, ...rest: unknown[]) => {
      bootContext = context;

      return (base.factory as (...args: unknown[]) => SettingsService)(context, ...rest);
    },
  } as unknown as ServiceDescriptor<ISettingsService, SettingsService>;
}

/**
 * Builds the `brud.core.settings.reader` descriptor: one exposure,
 * `brud.settings.reader@1`, open to every caller. It reads through
 * `ctx.resolve('brud.settings')` at call time; until that resolves it serves
 * the defaults and a no-op subscription.
 */
export function createSettingsReaderDescriptor(): ServiceDescriptor<ISettingsReader> {
  const base = defineParticipant<ISettingsReaderApi>({
    id: SettingsReaderToken.id,
    description: SettingsReaderToken.description,
    tier: SETTINGS_SERVICE_TIER,
    requests: [SETTINGS_READ_CAPABILITY],
    exposes: {
      [SETTINGS_READER_EXPOSURE]: {
        version: 1,
        scope: 'runtime',
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
  })();

  return { ...base, token: SettingsReaderToken, dependencies: [SettingsToken] } as unknown as ServiceDescriptor<ISettingsReader>;
}
