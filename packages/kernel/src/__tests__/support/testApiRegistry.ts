import type { IKernelAccessBroker, ServiceInfo } from '../../contracts/accessBroker.js';
import type { ServiceContext } from '../../contracts/lifecycle.js';
import type { ServiceDescriptor } from '../../contracts/serviceDescriptor.js';
import type { ServiceToken } from '../../contracts/serviceToken.js';
import type { IActionManager } from '../../../../services/ActionManager/contracts/index.js';
import type { IBrudToolsService } from '../../../../services/BrudTools/contracts/index.js';
import type { IBrudFileSystem } from '../../../../services/BrudFileSystem/contracts/index.js';
import { ReadOnlyFacade } from '../../../../services/BrudFileSystem/projection/index.js';
import { ExposedApiRegistryService } from '../../../services/ExposedApiRegistry/orchestrator/ExposedApiRegistryService.js';
import type { IExposedApiRegistry } from '../../../services/ExposedApiRegistry/contracts/IExposedApiRegistry.js';
import {
  CORE_API_NAME,
  lastProjectionWins,
} from '../../../services/ExposedApiRegistry/contracts/coreApis.js';
import { ExposedApiRegistryToken } from '../../../services/ExposedApiRegistry/descriptor/tokens.js';
import type { IUniversalHistoryService } from '../../../../services/UniversalHistory/contracts/index.js';
import { ReadOnlyUniversalHistoryFacade } from '../../../../services/UniversalHistory/descriptor/ReadOnlyUniversalHistoryFacade.js';
import { UniversalHistoryToken } from '../../../../services/UniversalHistory/descriptor/tokens.js';
import { namespaceHistoryFor } from '../../../../services/UniversalHistory/unified/adapters/PluginHistoryFacade.js';
import { createReadOnlyNamespaceHandle } from '../../../../services/UniversalHistory/unified/service/NamespaceHandle.js';
import type { NamespaceHistoryHandle } from '../../../../services/UniversalHistory/unified/service/types.js';
import { FileSystemToken } from '../../../../services/BrudFileSystem/descriptor/tokens.js';
import { BrudToolsToken } from '../../../../services/BrudTools/descriptor/tokens.js';
import { ActionManagerToken } from '../../../../services/ActionManager/descriptor/tokens.js';
import { PluginContext } from '../../../../services/PluginManager/contracts/PluginContext.js';
import type { IPluginLogger, IPluginSubscriptions } from '../../../../services/PluginManager/contracts/IPluginContext.js';
import type { PluginManifest } from '../../../../services/PluginManager/contracts/manifest.js';
import type { PluginPermission } from '../../../../services/PluginManager/contracts/permissions.js';
import type { InternalPluginRecord } from '../../../../services/PluginManager/orchestrator/types.js';
import { createRegistryCapabilityProviders } from '../../../../services/PluginManager/orchestrator/registryCapabilities.js';
import type { ITerminalService } from '../../../../services/TerminalService/contracts/ITerminalService.js';
import { TerminalToken } from '../../../../services/TerminalService/descriptor/tokens.js';
import type { IUtilityService } from '../../../../services/UtilityService/contracts/IUtilityService.js';
import { UtilityToken } from '../../../../services/UtilityService/descriptor/tokens.js';

/** Public-exposure marker in this test composition. */
const PUBLIC_API_CAPABILITY = '*';

/** Minimal broker over an explicit token-id map. */
export class MapServiceBroker implements IKernelAccessBroker {
  constructor(
    private readonly services: ReadonlyMap<string, unknown>,
    private readonly onAccess?: (tokenId: string) => void,
  ) {}

  requestAccess<TService>(caller: ServiceContext, token: ServiceToken<TService>): TService {
    void caller;
    this.onAccess?.(token.id);

    const service = this.services.get(token.id);

    if (service === undefined) {
      throw new Error(`Service "${token.id}" is not registered`);
    }

    return service as TService;
  }

  hasService(token: ServiceToken<unknown>): boolean {
    return this.services.has(token.id);
  }

  listServices(): readonly ServiceInfo[] {
    return Object.freeze(Array.from(this.services.keys()).map((id) => ({
      id,
      description: id,
      tier: 'core' as const,
      initialized: true,
    })));
  }
}

/** Services the test helper can register. */
export interface TestApiServices {
  readonly fileSystem?: IBrudFileSystem;
  readonly universalHistory?: IUniversalHistoryService;
  readonly brudTools?: IBrudToolsService;
  readonly actionManager?: IActionManager;
  readonly terminal?: ITerminalService;
  readonly utilities?: IUtilityService;
}

/**
 * Builds a real Registry seeded with the same projections the standard
 * descriptors use.
 */
export function createTestApiRegistry(options: {
  readonly broker: IKernelAccessBroker;
  readonly workspaceRoot: string;
  readonly services?: TestApiServices;
  readonly seed?: (registry: ExposedApiRegistryService) => void;
  readonly close?: boolean;
}): ExposedApiRegistryService {
  const registry = new ExposedApiRegistryService({
    broker: options.broker,
    callerContext: {
      callerId: 'test.api.registry',
      tier: 'core',
      options: { 'workspace.root': options.workspaceRoot },
    },
  });
  const services = options.services ?? {};

  if (services.fileSystem !== undefined) {
    registry.registerApi(CORE_API_NAME.fileSystem, FileSystemToken, {
      capability: 'fs:read',
      scope: 'runtime',
      projection: (service) => new ReadOnlyFacade(service as IBrudFileSystem),
      combine: lastProjectionWins,
    });
    registry.registerApi(CORE_API_NAME.fileSystem, FileSystemToken, {
      capability: 'fs:write',
      scope: 'runtime',
      combine: lastProjectionWins,
    });
  }

  if (services.universalHistory !== undefined) {
    registry.registerApi(CORE_API_NAME.universalHistory, UniversalHistoryToken, {
      capability: 'history:read',
      scope: 'runtime',
      projection: (service, caller) => (
        caller.capabilities.has('history:write') && caller.official
          ? service
          : new ReadOnlyUniversalHistoryFacade(service as IUniversalHistoryService)
      ),
      combine: lastProjectionWins,
    });
    registry.registerApi(CORE_API_NAME.universalHistory, UniversalHistoryToken, {
      capability: 'history:write',
      scope: 'runtime',
      projection: (service, caller) => (
        caller.official
          ? service
          : new ReadOnlyUniversalHistoryFacade(service as IUniversalHistoryService)
      ),
      combine: lastProjectionWins,
    });

    const namespaceProjection = (service: unknown, caller: {
      readonly capabilities: ReadonlySet<string>;
      readonly official: boolean;
      readonly subjectId: string;
    }): NamespaceHistoryHandle => {
      const handle = namespaceHistoryFor(
        service as IUniversalHistoryService,
        caller.subjectId,
        { official: caller.official },
      );

      if (handle === undefined) {
        throw new Error('Namespace history requires the unified history engine');
      }

      return caller.capabilities.has('history:write')
        ? handle
        : createReadOnlyNamespaceHandle(handle);
    };

    registry.registerApi(CORE_API_NAME.namespaceHistory, UniversalHistoryToken, {
      capability: 'history:read',
      scope: 'runtime',
      projection: namespaceProjection,
      combine: lastProjectionWins,
    });
    registry.registerApi(CORE_API_NAME.namespaceHistory, UniversalHistoryToken, {
      capability: 'history:write',
      scope: 'runtime',
      projection: namespaceProjection,
      combine: lastProjectionWins,
    });
  }

  if (services.brudTools !== undefined) {
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
  }

  if (services.actionManager !== undefined) {
    registry.registerApi(CORE_API_NAME.actionManager, ActionManagerToken, {
      capability: 'actions:register',
      scope: 'runtime',
    });
  }

  if (services.terminal !== undefined) {
    registry.registerApi(CORE_API_NAME.terminal, TerminalToken, {
      capability: 'terminal:execute',
      scope: 'runtime',
    });
  }

  if (services.utilities !== undefined) {
    registry.registerApi(CORE_API_NAME.utilities, UtilityToken, {
      capability: PUBLIC_API_CAPABILITY,
      scope: 'runtime',
    });
  }

  options.seed?.(registry);

  if (options.close !== false) {
    registry.closeRegistration();
  }

  return registry;
}

/**
 * Builds a Registry descriptor whose factory seeds entries in a custom kernel
 * that has no standard boot pinner.
 */
export function createSeededApiRegistryDescriptor(
  seed: (registry: IExposedApiRegistry) => void,
): ServiceDescriptor<IExposedApiRegistry, ExposedApiRegistryService> {
  return {
    token: ExposedApiRegistryToken,
    tier: 'core',
    dependencies: [],
    accessPolicy: {
      allowedCallers: ['kernel', 'PluginManager', 'brud.host.daemon'],
    },
    factory: (context, broker): ExposedApiRegistryService => {
      const registry = new ExposedApiRegistryService({
        broker,
        callerContext: {
          callerId: ExposedApiRegistryToken.id,
          tier: 'core',
          options: context.options,
        },
      });

      seed(registry);
      registry.closeRegistration();

      return registry;
    },
  };
}
/** Silent logger for test contexts. */
const SILENT_LOGGER = Object.freeze({
  info: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
});

/** Options for {@link createTestPluginContext}. */
export interface TestPluginContextOptions {
  readonly pluginId: string;
  readonly permissions: readonly PluginPermission[];
  readonly official?: boolean;
  readonly workspaceRoot?: string;
  readonly services?: TestApiServices;
  readonly seed?: (registry: ExposedApiRegistryService) => void;
  readonly onAccess?: (tokenId: string) => void;
  readonly extraServices?: ReadonlyMap<string, unknown>;
  readonly logger?: IPluginLogger;
  readonly subscriptions?: IPluginSubscriptions;
}

/**
 * Builds a PluginContext through the same Registry-backed provider builder the
 * PluginManager uses. No direct capability providers are accepted.
 */
export function createTestPluginContext(options: TestPluginContextOptions): {
  readonly context: PluginContext;
  readonly registry: ExposedApiRegistryService;
  readonly broker: MapServiceBroker;
} {
  const workspaceRoot = options.workspaceRoot ?? '/workspace';
  const services = options.services ?? {};
  const serviceMap = new Map<string, unknown>();

  if (services.fileSystem !== undefined) {
    serviceMap.set(FileSystemToken.id, services.fileSystem);
  }

  if (services.universalHistory !== undefined) {
    serviceMap.set(UniversalHistoryToken.id, services.universalHistory);
  }

  if (services.brudTools !== undefined) {
    serviceMap.set(BrudToolsToken.id, services.brudTools);
  }

  if (services.actionManager !== undefined) {
    serviceMap.set(ActionManagerToken.id, services.actionManager);
  }

  if (services.terminal !== undefined) {
    serviceMap.set(TerminalToken.id, services.terminal);
  }

  if (services.utilities !== undefined) {
    serviceMap.set(UtilityToken.id, services.utilities);
  }

  for (const [tokenId, service] of options.extraServices ?? []) {
    serviceMap.set(tokenId, service);
  }

  const broker = new MapServiceBroker(serviceMap, options.onAccess);
  const registry = createTestApiRegistry({
    broker,
    workspaceRoot,
    services,
    ...(options.seed === undefined ? {} : { seed: options.seed }),
    close: false,
  });

  registry.closeRegistration();

  const manifest: PluginManifest = {
    id: options.pluginId,
    name: options.pluginId,
    version: '1.0.0',
    permissions: [...options.permissions],
  };
  const record: InternalPluginRecord = {
    plugin: {
      manifest,
      activate: (): void => undefined,
    },
    manifest,
    official: options.official ?? false,
    state: 'unloaded',
  };
  const capabilities = createRegistryCapabilityProviders(
    registry,
    record,
    options.permissions,
    workspaceRoot,
  );
  const context = new PluginContext({
    pluginId: options.pluginId,
    workspaceRoot,
    permissions: options.permissions,
    official: options.official ?? false,
    logger: options.logger ?? SILENT_LOGGER,
    ...(options.subscriptions === undefined ? {} : { subscriptions: options.subscriptions }),
    capabilities,
  });

  return { context, registry, broker };
}
