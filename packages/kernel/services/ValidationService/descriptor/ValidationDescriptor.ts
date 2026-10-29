import type { ServiceContext, ServiceTier } from '../../../src/contracts/lifecycle.js';
import type { ServiceDescriptor } from '../../../src/contracts/serviceDescriptor.js';
import type { SettingsSnapshot } from '../../SettingsService/contracts/ISettingsService.js';
import { SettingsToken } from '../../SettingsService/descriptor/tokens.js';
import {
  READ_CONCURRENCY_MAX,
  READ_MAX_AGGREGATE_BYTES_MAX,
  READ_MAX_BATCH_FILES_MAX,
} from '../../SettingsService/model/defaults.js';
import { WorkspaceToken } from '../../WorkspaceService/descriptor/tokens.js';
import type {
  IValidationService,
  ValidationEnvironment,
  ValidationFlavor,
  ValidationPolicy,
  ValidationWorkspacePort,
} from '../contracts/IValidationService.js';
import { ValidationService } from '../orchestrator/ValidationService.js';
import { ValidationToken } from './tokens.js';

/** Tier assigned to the validation descriptor. */
export const VALIDATION_SERVICE_TIER: ServiceTier = 'core';

/** Configuration for {@link createValidationDescriptor}. */
export interface ValidationDescriptorOptions {
  /**
   * Explicit policy override. Intended for standalone compositions and tests;
   * the standard kernel always ingests the frozen boot snapshot instead.
   */
  readonly policy?: ValidationPolicy;

  /**
   * Workspace authority override. Defaults to `brud.core.workspace` resolved
   * through the access broker.
   */
  readonly workspace?: ValidationWorkspacePort;

  /** Path flavor override. Defaults to the host platform. */
  readonly flavor?: ValidationFlavor;

  /** Home directory used to expand `~` in commands. Defaults to the host home. */
  readonly homeDirectory?: string;
}

/**
 * Narrows the boot snapshot to the frozen validation policy.
 *
 * `ValidationService` deliberately drops `plugins`: rollout mode is a plugin
 * manager concern and must not influence a gate that runs before a plugin.
 *
 * @param snapshot - Frozen settings snapshot.
 */
export function toValidationPolicy(snapshot: SettingsSnapshot): ValidationPolicy {
  return Object.freeze({
    workspaceBoundaryEnabled: snapshot.workspaceBoundaryEnabled,
    commandValidationEnabled: snapshot.commandValidationEnabled,
    toolAllowList: Object.freeze({ ...snapshot.toolAllowList }),
    readConcurrency: snapshot.readConcurrency,
    readMaxBatchFiles: snapshot.readMaxBatchFiles,
    readMaxAggregateBytes: snapshot.readMaxAggregateBytes,
    schemaVersion: 1 as const,
  });
}

/**
 * Builds the validation service descriptor.
 *
 * Boot position is after workspace and before terminal/plugins. Both
 * dependencies are ordering guarantees: the workspace authority must be
 * constructed, and the settings snapshot captured, before policy is frozen
 * here. The snapshot is read once at construction and never subscribed to, so
 * an in-flight operation cannot observe a policy change between validation
 * and commit.
 *
 * @param options - Optional policy, workspace, flavor and home overrides.
 * @returns A core-tier descriptor for `brud.core.validation`.
 */
export function createValidationDescriptor(
  options?: ValidationDescriptorOptions,
): ServiceDescriptor<IValidationService, ValidationService> {
  return {
    token: ValidationToken,
    tier: VALIDATION_SERVICE_TIER,
    dependencies: [SettingsToken, WorkspaceToken],
    accessPolicy: { deniedCallers: [] },
    factory: (context: ServiceContext, broker): ValidationService => {
      const kernelCaller: ServiceContext = {
        callerId: 'kernel',
        tier: 'kernel',
        workspaceRoot: context.workspaceRoot,
      };
      // The access broker only serves requests while the kernel is RUNNING and
      // service factories run during BOOTING, so the dependencies are resolved
      // through this forwarding proxy and touched only on first use. Policy is
      // read exactly once, on that first use: no accessor is evaluated before
      // the kernel is RUNNING, and the boot snapshot cannot change afterwards
      // because the service never subscribes to `onChange`.
      let policy: ValidationPolicy | undefined = options?.policy;
      let workspace: ValidationWorkspacePort | undefined = options?.workspace;

      const resolvePolicy = (): ValidationPolicy => {
        policy ??= toValidationPolicy(broker.requestAccess(kernelCaller, SettingsToken).getSnapshot());

        return policy;
      };
      const resolveWorkspace = (): ValidationWorkspacePort => {
        workspace ??= broker.requestAccess(kernelCaller, WorkspaceToken);

        return workspace;
      };

      // Boot-time pinning: the access broker only serves while the kernel is
      // RUNNING, so the first freeze uses a placeholder and the real snapshot
      // is ingested once `pinBootPolicy` runs, which still happens before the
      // kernel announces RUNNING. Policy is read exactly once and never
      // subscribed to, so it cannot move during an operation.
      const service = new ValidationService({
        policy: BOOT_PLACEHOLDER_POLICY,
        workspace: lazyWorkspace(resolveWorkspace),
        environment: {
          homeDirectory: options?.homeDirectory
            ?? (process.env.HOME ?? process.env.USERPROFILE ?? '/home'),
          flavor: options?.flavor ?? defaultValidationFlavor(),
        },
      });

      registerBootPinner(service, async (): Promise<void> => {
        await service.pinBootPolicy({
          policy: resolvePolicy(),
          workspace: resolveWorkspace(),
        });
      });

      return service;
    },
  };
}

/**
 * Resolves the default path flavor from the host platform.
 */
export function defaultValidationFlavor(): ValidationFlavor {
  return process.platform === 'win32' ? 'win32' : 'posix';
}

/** Policy used until the boot snapshot is ingested. */
const BOOT_PLACEHOLDER_POLICY: ValidationPolicy = Object.freeze({
  workspaceBoundaryEnabled: true,
  commandValidationEnabled: true,
  toolAllowList: Object.freeze({}),
  readConcurrency: READ_CONCURRENCY_MAX,
  readMaxBatchFiles: READ_MAX_BATCH_FILES_MAX,
  readMaxAggregateBytes: READ_MAX_AGGREGATE_BYTES_MAX,
  schemaVersion: 1 as const,
});

/**
 * Boot pinning hooks, keyed by service instance.
 *
 * The standard kernel composition calls {@link pinBootPolicies} while it
 * temporarily suspends the access broker's lifecycle gate, so a descriptor can
 * ingest its boot snapshot before the broker reports `RUNNING`.
 */
const BOOT_PINNERS = new WeakMap<object, () => Promise<void>>();

/**
 * Registers the boot-time pinner for a validation instance.
 *
 * @param service - Validation service instance.
 * @param pin - Callback that ingests and freezes the boot snapshot.
 */
export function registerBootPinner(service: object, pin: () => Promise<void>): void {
  BOOT_PINNERS.set(service, pin);
}

/**
 * Runs every registered boot pinner.
 *
 * Called by the kernel composition after every factory and initializer has
 * run, with the access broker's lifecycle gate suspended for the duration.
 *
 * @param instances - Resolved instances, in boot order.
 */
export async function pinBootPolicies(instances: readonly object[]): Promise<void> {
  for (const instance of instances) {
    const pin = BOOT_PINNERS.get(instance);

    if (pin !== undefined) {
      await pin();
    }
  }
}

/**
 * Forwards every workspace read to the resolved workspace authority.
 *
 * @param resolve - Deferred workspace resolver.
 */
function lazyWorkspace(resolve: () => ValidationWorkspacePort): ValidationWorkspacePort {
  const proxy = new Proxy({} as ValidationWorkspacePort, {
    get: (_target, property: string | symbol): unknown => {
      const instance = resolve();

      if (property === 'resolve') {
        return (userPath: string) => instance.resolve(userPath);
      }

      if (property === 'toAbsolutePath') {
        return (kernelPath: string, rootHint?: string) => instance.toAbsolutePath(kernelPath, rootHint);
      }

      return Reflect.get(instance, property) as unknown;
    },
  });

  return proxy;
}
