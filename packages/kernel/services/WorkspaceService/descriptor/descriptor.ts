import type { ServiceContext, ServiceTier } from '../../../src/contracts/lifecycle.js';
import type { ServiceDescriptor } from '../../../src/contracts/serviceDescriptor.js';
import type { IStorageDriver } from '../../../drivers/contracts/index.js';
import { NodeStorageDriver } from '../../../drivers/node/index.js';
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

/** Tier assigned to the workspace descriptor. */
export const WORKSPACE_SERVICE_TIER: ServiceTier = 'core';

/** Configuration for {@link createWorkspaceDescriptor}. */
export interface WorkspaceDescriptorOptions {
  /**
   * Declared roots, in routing order. Defaults to the single boot workspace
   * root supplied to `kernel.boot({ workspaceRoot })`.
   */
  readonly roots?: readonly string[];

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
    factory: (context: ServiceContext): WorkspaceService => new WorkspaceService({
      roots: options?.roots !== undefined && options.roots.length > 0
        ? options.roots
        : [context.workspaceRoot],
      primaryRoot: context.workspaceRoot,
      port,
      ...(options?.flavor === undefined ? {} : { flavor: options.flavor }),
      ...(options?.allowFilesystemRoot === undefined
        ? {}
        : { allowFilesystemRoot: options.allowFilesystemRoot }),
      ...(options?.onWarning === undefined ? {} : { onWarning: options.onWarning }),
    }),
  };
}

/** Standard workspace descriptor over the boot workspace root. */
export const workspaceDescriptor: ServiceDescriptor<IWorkspaceService, WorkspaceService> =
  createWorkspaceDescriptor();

/** Backwards-compatible alias for {@link workspaceDescriptor}. */
export const WorkspaceDescriptor: ServiceDescriptor<IWorkspaceService, WorkspaceService> =
  workspaceDescriptor;
