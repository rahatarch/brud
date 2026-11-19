import {
  ExposedApiRegistryToken,
  withExposureBindings,
  type IExposedApiRegistry,
  type IKernelAccessBroker,
  type ServiceDescriptor,
  type ServiceTier,
} from '@brud/kernel';
import type { IBrudToolsService } from '../contracts/IBrudToolsService.js';
import { BRUD_TOOLS_EXPOSURE, SETTINGS_READER_EXPOSURE } from '../contracts/exposure.js';
import { BrudToolsService, type IToolsLogger } from '../orchestrator/index.js';
import { BrudToolsToken } from './tokens.js';
import { toolsFacade } from './toolsExposure.js';

/** Tier assigned to the BrudTools descriptor. */
export const BRUD_TOOLS_SERVICE_TIER: ServiceTier = 'core';

/** Options for {@link createBrudToolsDescriptor}. */
export interface BrudToolsDescriptorOptions {
  /** Receives non-fatal warnings. */
  readonly logger?: IToolsLogger;
}

/** The slice of the settings exposure BrudTools reads. */
interface SettingsReaderView {
  getSnapshot(): { readonly toolAllowList?: Readonly<Record<string, boolean>> };
}

/**
 * Builds the BrudTools descriptor: a participant like any other.
 *
 * It declares one exposure, `brud.tools@1` (scope `runtime`), bound to a
 * projection shaped by the real caller (see `toolsFacade`). It reaches other
 * participants only through the exposed-API registry, as itself: the tool
 * allow-list is read by resolving `brud.settings.reader`; when that does not
 * resolve, every tool is allowed (fail open, unchanged).
 *
 * @param options - Descriptor options.
 * @returns The descriptor.
 */
export function createBrudToolsDescriptor(
  options?: BrudToolsDescriptorOptions,
): ServiceDescriptor<IBrudToolsService, BrudToolsService> {
  return {
    token: BrudToolsToken,
    tier: BRUD_TOOLS_SERVICE_TIER,
    dependencies: [],
    manifest: {
      requests: { capabilities: [] },
      exposures: [{ name: BRUD_TOOLS_EXPOSURE, version: 1, scope: 'runtime' }],
      events: [],
    },
    factory: (): BrudToolsService => {
      let registry: IExposedApiRegistry | undefined;
      let settings: SettingsReaderView | null = null;

      const getToolAllowList = (): Readonly<Record<string, boolean>> => {
        if (registry === undefined) {
          return {};
        }

        settings ??= registry.resolve<SettingsReaderView>(SETTINGS_READER_EXPOSURE);

        return settings?.getSnapshot().toolAllowList ?? {};
      };

      const service = new BrudToolsService({
        ...(options?.logger === undefined ? {} : { logger: options.logger }),
        getToolAllowList,
      });

      Object.defineProperty(service, 'onRunning', {
        value: (broker: IKernelAccessBroker): void => {
          registry = broker.requestAccess(
            { callerId: BrudToolsToken.id, tier: BRUD_TOOLS_SERVICE_TIER, options: {} },
            ExposedApiRegistryToken,
          );
        },
        enumerable: false,
      });

      return withExposureBindings(service, {
        [`${BRUD_TOOLS_EXPOSURE}@1`]: {
          projection: (_service: unknown, caller) => toolsFacade(service, caller),
        },
      });
    },
  };
}
