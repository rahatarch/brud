import type { ServiceContext, ServiceTier } from '@brud/kernel';
import type { ServiceDescriptor } from '@brud/kernel';
import { CORE_API_NAME, lastProjectionWins, withExposedApis } from '@brud/kernel';
import type { IPluginLogger } from '../../PluginManager/contracts/IPluginContext.js';
import type { ISettingsReader } from '../../SettingsService/contracts/ISettingsService.js';
import { SettingsReaderToken } from '../../SettingsService/descriptor/tokens.js';
import type { IBrudToolsService } from '../contracts/IBrudToolsService.js';
import {
  BrudToolsService,
  type BrudToolsDependencies,
} from '../orchestrator/index.js';
import { BrudToolsToken } from './tokens.js';

/** Tier assigned to the BrudTools descriptor. */
export const BRUD_TOOLS_SERVICE_TIER: ServiceTier = 'core';

/** Configuration for {@link createBrudToolsDescriptor}. */
export interface BrudToolsDescriptorOptions {
  /** Optional diagnostic sink override. */
  readonly logger?: IPluginLogger;
}

/**
 * Builds the BrudTools service descriptor.
 *
 * The service validates every payload against the target tool's registered
 * `parametersSchema` through the kernel's zero-dependency JSON Schema
 * compiler. It therefore declares no validation-service dependency: the
 * compiler is a pure module, and no operation-kind gate is involved.
 *
 * Boot position is before the plugin manager (rollout plan §2.3.4): the
 * routing table must exist before any plugin activates, so a plugin's tools
 * become routable the moment its `activate()` returns.
 *
 * @param options - Optional logger override.
 * @returns A core-tier descriptor for `brud.core.tools`.
 */
export function createBrudToolsDescriptor(
  options?: BrudToolsDescriptorOptions,
): ServiceDescriptor<IBrudToolsService, BrudToolsService> {
  return {
    token: BrudToolsToken,
    tier: BRUD_TOOLS_SERVICE_TIER,
    dependencies: [],
    accessPolicy: { deniedCallers: [] },
    factory: (context: ServiceContext, broker): BrudToolsService => {
      // The allow-list is read lazily, on the first dispatch, so the service's
      // declared dependency graph stays empty and standalone construction keeps
      // working. The access broker only serves requests while the kernel is
      // RUNNING, and dispatch is a runtime operation, so this is safe. The
      // reader token carries no access policy; by the time dispatch runs the
      // settings service registered before tools (boot order) is available.
      let reader: ISettingsReader | undefined;
      const getToolAllowList = (): Readonly<Record<string, boolean>> => {
        reader ??= broker.requestAccess(
          {
            callerId: 'kernel',
            tier: 'kernel',
            options: context.options,
          },
          SettingsReaderToken,
        );

        return reader.getSnapshot().toolAllowList;
      };

      const dependencies: BrudToolsDependencies = {
        ...(options?.logger === undefined ? {} : { logger: options.logger }),
        getToolAllowList,
      };

      const service = new BrudToolsService(dependencies);

      return withExposedApis(service, (registry) => {
        registry.registerApi(CORE_API_NAME.brudTools, BrudToolsToken, {
          capability: 'tools:register',
          scope: 'runtime',
          combine: lastProjectionWins,
        });
        registry.registerApi(CORE_API_NAME.brudTools, BrudToolsToken, {
          capability: 'tools:execute',
          scope: 'runtime',
          combine: lastProjectionWins,
        });
      });
    },
  };
}
