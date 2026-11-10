import type { IKernelAccessBroker } from '../../../src/contracts/accessBroker.js';
import type {
  ServiceContext,
  ServiceTier,
} from '../../../src/contracts/lifecycle.js';
import type { ServiceDescriptor } from '../../../src/contracts/serviceDescriptor.js';
import type { ServiceToken } from '../../../src/contracts/serviceToken.js';
import type { IBrandScope } from '../../BrandRegistry/contracts/IBrandScope.js';
import { CORE_API_NAME, withExposedApis } from '../../ExposedApiRegistry/contracts/index.js';
import type { IExposedApiRegistry } from '../../ExposedApiRegistry/contracts/IExposedApiRegistry.js';
import { ExposedApiRegistryToken } from '../../ExposedApiRegistry/descriptor/tokens.js';
import { ActionManagerToken } from '../../ActionManager/descriptor/tokens.js';
import { BrudToolsToken } from '../../BrudTools/descriptor/tokens.js';
import { FileSystemToken } from '../../BrudFileSystem/descriptor/tokens.js';
import { UniversalHistoryToken } from '../../UniversalHistory/descriptor/tokens.js';
import { UtilityToken } from '../../UtilityService/descriptor/tokens.js';
import { TerminalToken } from '../../TerminalService/descriptor/tokens.js';
import type { IBrudPlugin } from '../contracts/IBrudPlugin.js';
import type { IPluginManagerService } from '../contracts/IPluginManager.js';
import {
  getDefaultOfficialPluginScope,
  hasOfficialPluginBrand,
} from '../contracts/branding.js';
import { PluginManagerToken } from '../contracts/tokens.js';
import { PluginManagerService } from '../orchestrator/PluginManagerService.js';

/** Tier assigned to the plugin manager descriptor. */
export const PLUGIN_MANAGER_SERVICE_TIER: ServiceTier = 'core';

/**
 * Configuration for {@link createPluginManagerDescriptor}.
 */
export interface PluginManagerDescriptorOptions {
  /**
   * Plugins registered as soon as the service is constructed.
   *
   * Registration is passive: the plugins are stored in `unloaded` state and
   * become active when the kernel runs the manager's `initialize` hook.
   */
  readonly initialPlugins?: readonly IBrudPlugin[];

  /**
   * Plugins the composition declared official.
   *
   * They are branded with {@link brandScope} when the manager is constructed.
   */
  readonly officialPlugins?: readonly object[];

  /** Boot-time brand scope used to certify and verify official plugins. */
  readonly brandScope?: IBrandScope;

  /**
   * Resolves the boot-time brand scope lazily.
   *
   * The standard composition uses this to read the Brand Registry instance
   * from the shared bag when the manager factory runs.
   */
  readonly brandScopeProvider?: () => IBrandScope;

  /**
   * Declares {@link UniversalHistoryToken} as a boot dependency.
   *
   * Defaults to `false`, so the descriptor can be composed into kernels that
   * do not provide history. The standard kernel opts in to guarantee history
   * initializes before plugins activate. Regardless of this flag, the history
   * facade is only exposed to plugins when the token is actually registered.
   */
  readonly withUniversalHistory?: boolean;

  /**
   * Declares {@link BrudToolsToken} as a boot dependency.
   *
   * Defaults to `false`, so base compositions keep their existing dependency
   * list. The standard kernel opts in so plugins can register and dispatch
   * tools through `context.registerTool` / `context.executeTool`. Regardless
   * of this flag, the tools handle is only exposed when the token is actually
   * registered.
   */
  readonly withTools?: boolean;

  /**
   * Declares {@link ActionManagerToken} as a boot dependency.
   *
   * Defaults to `false`, so base compositions keep their existing dependency
   * list. The standard kernel opts in so plugins holding `actions:register`
   * can call `context.registerAction`. Regardless of this flag, the action
   * handle is only exposed when the token is actually registered.
   */
  readonly withActions?: boolean;

  /**
   * Declares {@link UtilityToken} as a boot dependency.
   *
   * Defaults to `false`, so base compositions keep their existing dependency
   * list. The standard kernel opts in so plugins can call
   * `context.getUtilities()` during activation. Regardless of this flag, the
   * utility handle is only exposed when the token is actually registered.
   */
  readonly withUtilities?: boolean;

  /**
   * Declares {@link TerminalToken} as a boot dependency.
   *
   * Defaults to `false`. The standard kernel opts in so plugins holding
   * `terminal:execute` can call `context.getTerminal()`. Regardless of this
   * flag, the terminal handle is only exposed when the token is actually
   * registered.
   */
  readonly withTerminal?: boolean;
}

/**
 * Builds the plugin manager descriptor.
 *
 * Dependencies are resolved lazily through the access broker. Descriptor
 * factories and `initialize` hooks run while the kernel is `BOOTING`, and the
 * broker refuses access until the kernel reaches `RUNNING`, so eager
 * resolution here would break boot. Plugins activate in the manager's
 * `onRunning` hook, after `RUNNING`, which is when these accessors first run.
 *
 * @param options - Initial plugins and boot dependency composition.
 * @returns A descriptor exposing {@link IPluginManagerService} at core tier.
 */
export function createPluginManagerDescriptor(
  options?: PluginManagerDescriptorOptions,
): ServiceDescriptor<IPluginManagerService, PluginManagerService> {
  const initialPlugins = options?.initialPlugins ?? [];
  const officialPlugins = options?.officialPlugins ?? [];
  const withUniversalHistory = options?.withUniversalHistory ?? false;
  const withTools = options?.withTools ?? false;
  const withActions = options?.withActions ?? false;
  const withUtilities = options?.withUtilities ?? false;
  const withTerminal = options?.withTerminal ?? false;

  const dependencies: ServiceToken<unknown>[] = withUniversalHistory
    ? [FileSystemToken, UniversalHistoryToken, ExposedApiRegistryToken]
    : [FileSystemToken, ExposedApiRegistryToken];

  if (withTools) {
    dependencies.push(BrudToolsToken);
  }

  if (withActions) {
    dependencies.push(ActionManagerToken);
  }

  if (withUtilities) {
    dependencies.push(UtilityToken);
  }

  if (withTerminal) {
    dependencies.push(TerminalToken);
  }

  return {
    token: PluginManagerToken,
    tier: PLUGIN_MANAGER_SERVICE_TIER,
    dependencies,
    factory: (
      context: ServiceContext,
      broker: IKernelAccessBroker,
    ): PluginManagerService => {
      const caller: ServiceContext = {
        callerId: PluginManagerToken.id,
        tier: PLUGIN_MANAGER_SERVICE_TIER,
        workspaceRoot: context.workspaceRoot,
      };

      const apiRegistry = (): IExposedApiRegistry =>
        broker.requestAccess(caller, ExposedApiRegistryToken);

      const brandScope = options?.brandScopeProvider?.()
        ?? options?.brandScope
        ?? getDefaultOfficialPluginScope();

      for (const plugin of officialPlugins) {
        brandScope.brand(plugin);
      }

      // Adopt plugins certified through the package-internal scope, which is
      // how standalone helpers and older in-process tests brand fixtures.
      for (const plugin of initialPlugins) {
        if (hasOfficialPluginBrand(plugin) && !brandScope.verify(plugin)) {
          brandScope.brand(plugin);
        }
      }

      const manager = new PluginManagerService({
        workspaceRoot: context.workspaceRoot,
        apiRegistry,
        isOfficial: (candidate) => brandScope.verify(candidate),
      });

      for (const plugin of initialPlugins) {
        manager.register(plugin);
      }

      return withExposedApis(manager, (registry) => {
        registry.registerApi(CORE_API_NAME.pluginManager, PluginManagerToken, {
          capability: 'plugins:manage',
        });
      });
    },
  };
}

/** Standard plugin manager descriptor with no initial plugins. */
export const PluginManagerDescriptor: ServiceDescriptor<
  IPluginManagerService,
  PluginManagerService
> = createPluginManagerDescriptor();
