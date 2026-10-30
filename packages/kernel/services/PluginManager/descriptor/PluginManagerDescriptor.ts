import type { IKernelAccessBroker } from '../../../src/contracts/accessBroker.js';
import type {
  ServiceContext,
  ServiceTier,
} from '../../../src/contracts/lifecycle.js';
import type { ServiceDescriptor } from '../../../src/contracts/serviceDescriptor.js';
import type { ServiceToken } from '../../../src/contracts/serviceToken.js';
import type { IBrudToolsService } from '../../BrudTools/contracts/index.js';
import { BrudToolsToken } from '../../BrudTools/descriptor/tokens.js';
import type { IBrudFileSystem } from '../../BrudFileSystem/contracts/index.js';
import { FileSystemToken } from '../../BrudFileSystem/descriptor/tokens.js';
import type { IUniversalHistoryService } from '../../UniversalHistory/contracts/index.js';
import { UniversalHistoryToken } from '../../UniversalHistory/descriptor/tokens.js';
import type { IBrudPlugin } from '../contracts/IBrudPlugin.js';
import type { IPluginManagerService } from '../contracts/IPluginManager.js';
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
  const withUniversalHistory = options?.withUniversalHistory ?? false;
  const withTools = options?.withTools ?? false;

  const dependencies: ServiceToken<unknown>[] = withUniversalHistory
    ? [FileSystemToken, UniversalHistoryToken]
    : [FileSystemToken];

  if (withTools) {
    dependencies.push(BrudToolsToken);
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

      const fileSystem = (): IBrudFileSystem => broker.requestAccess(caller, FileSystemToken);

      const universalHistory: (() => IUniversalHistoryService) | undefined =
        broker.hasService(UniversalHistoryToken)
          ? (): IUniversalHistoryService => broker.requestAccess(caller, UniversalHistoryToken)
          : undefined;

      const brudTools: (() => IBrudToolsService) | undefined =
        withTools && broker.hasService(BrudToolsToken)
          ? (): IBrudToolsService => broker.requestAccess(caller, BrudToolsToken)
          : undefined;

      const manager = new PluginManagerService({
        workspaceRoot: context.workspaceRoot,
        fileSystem,
        ...(universalHistory === undefined ? {} : { universalHistory }),
        ...(brudTools === undefined ? {} : { brudTools }),
      });

      for (const plugin of initialPlugins) {
        manager.register(plugin);
      }

      return manager;
    },
  };
}

/** Standard plugin manager descriptor with no initial plugins. */
export const PluginManagerDescriptor: ServiceDescriptor<
  IPluginManagerService,
  PluginManagerService
> = createPluginManagerDescriptor();
