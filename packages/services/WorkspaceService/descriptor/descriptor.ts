import type { ServiceContext, ServiceTier } from '@brud/kernel';
import type { ServiceDescriptor } from '@brud/kernel';
import type { IStorageDriver } from '@brud/kernel';
import { NodeStorageDriver } from '@brud/kernel';
import { CORE_API_NAME, withExposedApis } from '@brud/kernel';
import { SettingsReaderToken } from '../../SettingsService/descriptor/tokens.js';
import type {
  IWorkspacePathPort,
  IWorkspaceService,
  WorkspacePathFlavor,
  WorkspaceWarning,
} from '../contracts/IWorkspaceService.js';
import { WorkspaceService } from '../orchestrator/WorkspaceService.js';
import { createStorageDriverPathPort } from '../ports/StorageDriverPathPort.js';
import { WorkspaceToken } from './tokens.js';
import { requireNamespacedWorkspaceRoot } from '../bootOptions.js';

/** Tier assigned to the workspace descriptor. */
export const WORKSPACE_SERVICE_TIER: ServiceTier = 'core';

/** Configuration for {@link createWorkspaceDescriptor}. */
export interface WorkspaceDescriptorOptions {
  /**
   * Declared roots, in routing order. Defaults to the single boot workspace
   * root supplied to `kernel.boot({ options: { 'workspace.root': root } })` or by the
   * service module's `primaryRoot` option.
   */
  readonly roots?: readonly string[];

  /**
   * Root selected as primary when no explicit primary is supplied.
   * Defaults to the boot workspace root on the service context.
   */
  readonly primaryRoot?: string;

  /**
   * Storage driver used for `realpath`/`lstat`. Defaults to the Node driver.
   * Pass the same driver the filesystem service uses so both see one host.
   */
  readonly driver?: IStorageDriver;

  /** Explicit port override, taking precedence over `driver`. */
  readonly port?: IWorkspacePathPort;

  /** Path flavor override. Defaults to the host platform. */
  readonly flavor?: WorkspacePathFlavor;

  /** Allows a root that is a filesystem or volume root. Defaults to `false`. */
  readonly allowFilesystemRoot?: boolean;

  /** Optional sink for structured warnings. */
  readonly onWarning?: (warning: WorkspaceWarning) => void;
}

/**
 * Builds the workspace service descriptor.
 *
 * The declared dependency on `brud.core.settings.reader` is an ordering and
 * availability guarantee, not a policy input: the frozen settings snapshot
 * exists before the workspace authority is constructed, and containment never
 * consults settings, so nothing a workspace-scope file contains can relax the
 * boundary (audit A6).
 *
 * Boot position is before the filesystem service. The canonical root this
 * service computes is the authority for path identity; `BrudFileSystem` stays
 * single-root and does not resolve this service at call time.
 *
 * @param options - Optional roots, driver, flavor, and warning overrides.
 * @returns A core-tier descriptor for `brud.core.workspace`.
 */
export function createWorkspaceDescriptor(
  options?: WorkspaceDescriptorOptions,
): ServiceDescriptor<IWorkspaceService, WorkspaceService> {
  const port = options?.port
    ?? createStorageDriverPathPort(options?.driver ?? new NodeStorageDriver());

  return {
    token: WorkspaceToken,
    tier: WORKSPACE_SERVICE_TIER,
    dependencies: [SettingsReaderToken],
    factory: (context: ServiceContext): WorkspaceService => withExposedApis(
      new WorkspaceService({
        roots: options?.roots !== undefined && options.roots.length > 0
          ? options.roots
          : [requireNamespacedWorkspaceRoot(context.options, WorkspaceToken.id)],
        primaryRoot: options?.primaryRoot
          ?? requireNamespacedWorkspaceRoot(context.options, WorkspaceToken.id),
        port,
        ...(options?.flavor === undefined ? {} : { flavor: options.flavor }),
        ...(options?.allowFilesystemRoot === undefined
          ? {}
          : { allowFilesystemRoot: options.allowFilesystemRoot }),
        ...(options?.onWarning === undefined ? {} : { onWarning: options.onWarning }),
      }),
      (registry) => {
        registry.registerApi(CORE_API_NAME.workspace, WorkspaceToken, {
          capability: 'workspace:read',
          scope: 'runtime',
        });
      },
    ),
  };
}
