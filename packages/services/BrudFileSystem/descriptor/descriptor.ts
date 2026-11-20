import type { IStorageDriver } from '../contracts/index.js';
import type { ServiceContext } from '@brud/kernel';
import type { ServiceDescriptor } from '@brud/kernel';
import type { ExposedApiCaller } from '@brud/kernel';
import { defineParticipant } from '@brud/sdk/participant';
import { FILESYSTEM_EXPOSURE, FILESYSTEM_JOURNAL_EXPOSURE, FS_READ_CAPABILITY, FS_WRITE_CAPABILITY } from '../contracts/exposure.js';
import { VALIDATION_EXPOSURE, VALIDATION_READ_CAPABILITY } from '../../ValidationService/contracts/exposure.js';
import type { IValidationService } from '../../ValidationService/contracts/IValidationService.js';
import { WORKSPACE_EXPOSURE, WORKSPACE_READ_CAPABILITY } from '../../WorkspaceService/contracts/exposure.js';
import type { IWorkspaceService } from '../../WorkspaceService/contracts/IWorkspaceService.js';
import type { WorkspacePathFlavor } from '../../WorkspaceService/contracts/IWorkspaceService.js';
import { requireContextString } from '@brud/kernel';
import type { IBrudFileSystem } from '../contracts/IBrudFileSystem/IBrudFileSystem.js';
import { DurableNodeStorageDriver } from '../drivers/DurableNodeStorageDriver.js';
import type { IFileMutationJournal } from '../events/types.js';
import { BrudFileSystem } from '../orchestrator/BrudFileSystem.js';
import type { ValidationAuthority, WorkspaceAuthority } from '../orchestrator/BrudFileSystem.js';
import { ReadOnlyFacade } from '../projection/ReadOnlyFacade/ReadOnlyFacade.js';
import { ScopedPartitionFacade } from '../projection/ScopedPartitionFacade/ScopedPartitionFacade.js';
import { FileSystemToken } from './tokens.js';

/** Namespace owned by the filesystem service in the context contract. */
export const FILESYSTEM_CONTEXT_SCOPE = 'filesystem';

/** Namespaced context field holding the workspace root. */
export const FILESYSTEM_ROOT_CONTEXT_FIELD = 'filesystem.root';

/**
 * Namespaced context field carrying this service's own partition scope.
 *
 * Partitions are the storage service's design. The kernel carries no partition
 * field; a caller that wants a scoped view supplies this key in its own
 * context options.
 */
export const FILESYSTEM_PARTITION_CONTEXT_FIELD = 'filesystem.partitionPrefix';

/** Configuration for {@link createFileSystemDescriptor}. */
export interface FileSystemDescriptorOptions {
  /** Storage backend used by the service. Defaults to {@link DurableNodeStorageDriver}. */
  readonly driver?: IStorageDriver;

  /**
   * Canonical workspace authority injected by the kernel composition.
   *
   * The standard bootstrap supplies a probe that returns the already
   * initialized `brud.core.workspace` instance. When omitted, the descriptor
   * builds a single-root `WorkspaceService` over the boot workspace root so
   * the filesystem remains usable in standalone compositions.
   */
  readonly workspace?: WorkspaceAuthority;

  /**
   * Policy authority injected by the kernel composition.
   *
   * The standard bootstrap supplies a probe that returns the already
   * initialized `brud.core.validation` instance; validation is constructed
   * after the filesystem in the boot order, so the probe is lazy. When
   * omitted, the filesystem constructs a standalone validation service over
   * its workspace authority.
   */
  readonly validation?: ValidationAuthority;

  /**
   * Reach the workspace and validation givers through their exposures
   * (`brud.workspace`, `brud.validation`) at call time. Used by the service
   * module when no explicit authority is supplied.
   */
  readonly resolveGivers?: boolean;

  /**
   * Canonical workspace root the service binds to when no workspace authority
   * is injected. Defaults to the declared `filesystem.root` context field.
   */
  readonly root?: string;

  /** Path flavor used by the standalone fallback workspace authority. */
  readonly flavor?: WorkspacePathFlavor;

  /**
   * Mutation journal the filesystem publishes pre/post descriptors to.
   * Defaults to a private journal that is enabled when a listener subscribes.
   */
  readonly mutationJournal?: IFileMutationJournal;

  /**
   * Protected-prefix capabilities granted to specific core callers.
   *
   * None are granted by default: the history engine writes `.brud/history`
   * through the storage driver, never through this service (D-15 U-7). A
   * capability is applied to the caller-facing projection rather than to the
   * shared instance.
   */
  readonly authorizedWriteScopesByCaller?: Readonly<Record<string, readonly string[]>>;
}

/**
 * Builds the filesystem service descriptor.
 *
 * Declared dependencies make the boot graph explicit:
 *
 * - `brud.core.workspace` is the single path authority. Every operation is
 *   canonicalized and containment-checked there before a driver is touched.
 * - `brud.core.settings.reader` establishes ordering behind the workspace
 *   authority; containment never consults mutable settings.
 *
 * @param options - Driver, workspace authority, root, and journal overrides.
 * @returns A core-tier descriptor for `brud.core.filesystem`.
 */
export function createFileSystemDescriptor(
  options?: FileSystemDescriptorOptions,
): ServiceDescriptor<IBrudFileSystem, BrudFileSystem> {
  const driver = options?.driver ?? new DurableNodeStorageDriver();

  const authorizedScopesByCaller = { ...options?.authorizedWriteScopesByCaller };

  const handle = (caller: ExposedApiCaller, instance: BrudFileSystem): IBrudFileSystem | null => {
    if (caller.capabilities.has(FS_WRITE_CAPABILITY)) {
      const scopes = caller.identity == null ? [] : authorizedScopesByCaller[caller.identity] ?? [];

      return scopes.length > 0 ? instance.createAuthorizedProjection(scopes) : instance;
    }

    return caller.capabilities.has(FS_READ_CAPABILITY) ? new ReadOnlyFacade(instance) : null;
  };

  const warmups: (() => void)[] = [];

  const base = defineParticipant<BrudFileSystem>({
    id: FileSystemToken.id,
    description: FileSystemToken.description,
    tier: 'core',
    ...(options?.resolveGivers === true ? { requests: [WORKSPACE_READ_CAPABILITY, VALIDATION_READ_CAPABILITY] } : {}),
    // Givers are resolved on this participant's own runtime chain, so a later
    // host-origin call reuses the handle instead of resolving under the host.
    onRunning: async (ctx) => {
      for (const warm of warmups) {
        warm();
      }

      await ctx.instance.bindDeferredWorkspace();
    },
    exposes: {
      // The mutation feed: official participants subscribe; only the
      // filesystem publishes.
      [FILESYSTEM_JOURNAL_EXPOSURE]: {
        version: 1,
        scope: 'any',
        policy: { policyVersion: 2, official: true },
        handle: (_caller, ctx) => {
          const journal = ctx.instance.mutationJournal;

          return {
            subscribe: (listener: Parameters<IFileMutationJournal['subscribe']>[0]) => journal.subscribe(listener),
          };
        },
      },
      [FILESYSTEM_EXPOSURE]: {
        version: 1,
        // Widened from runtime (2026-11-20): history reaches this giver while
        // serving host-started calls; the capability policy still gates access.
        scope: 'any',
        policy: { policyVersion: 2, capabilities: [FS_READ_CAPABILITY] },
        handle: (caller, ctx) => handle(caller, ctx.instance),
      },
    },
    create: (ctx) => {
      warmups.length = 0;
      const giver = <T>(name: string): (() => T) => {
        let cached: T | null = null;

        warmups.push(() => {
          cached ??= ctx.resolve<T>(name);
        });

        return (): T => {
          cached ??= ctx.resolve<T>(name);

          if (cached === null) {
            throw new Error(`${FileSystemToken.id}: ${name} is not resolvable`);
          }

          return cached;
        };
      };
      const workspace = options?.workspace
        ?? (options?.resolveGivers === true ? giver<IWorkspaceService>(WORKSPACE_EXPOSURE) : undefined);
      const validation = options?.validation
        ?? (options?.resolveGivers === true ? giver<IValidationService>(VALIDATION_EXPOSURE) : undefined);
      const root = options?.root ?? requireContextString(
        ctx.bootOptions,
        FILESYSTEM_ROOT_CONTEXT_FIELD,
        FileSystemToken.id,
      );
      const serviceOptions = {
        root,
        ...(options?.mutationJournal === undefined
          ? {}
          : { mutationJournal: options.mutationJournal }),
        ...(options?.flavor === undefined ? {} : { flavor: options.flavor }),
        ...(validation === undefined ? {} : { validation }),
        ...(options?.resolveGivers === true && options.workspace === undefined ? { deferWorkspace: true } : {}),
      };

      return workspace !== undefined
        ? new BrudFileSystem(workspace, driver, serviceOptions)
        : new BrudFileSystem(root, driver, serviceOptions);
    },
  })();

  return {
    ...base,
    token: FileSystemToken,
    // Token-level projection, kept for hosts that take the token directly.
    project: (instance: BrudFileSystem, caller: ServiceContext): IBrudFileSystem => {
      const authorizedScopes = authorizedScopesByCaller[caller.callerId] ?? [];
      let projection: IBrudFileSystem = caller.tier === 'core' && authorizedScopes.length > 0
        ? instance.createAuthorizedProjection(authorizedScopes)
        : instance;

      const partitionPrefix = caller.options?.[FILESYSTEM_PARTITION_CONTEXT_FIELD];

      if (typeof partitionPrefix === 'string' && partitionPrefix.length > 0) {
        projection = new ScopedPartitionFacade(projection, partitionPrefix);
      }

      if (caller.tier === 'userland') {
        projection = new ReadOnlyFacade(projection);
      }

      if (caller.tier === 'kernel' && (typeof partitionPrefix !== 'string' || partitionPrefix.length === 0)) {
        // Raw writable handles are reserved for `tier: 'core'`. Kernel-tier
        // callers without an explicit partition receive read-only access.
        projection = new ReadOnlyFacade(projection);
      }

      return projection;
    },
  } as unknown as ServiceDescriptor<IBrudFileSystem, BrudFileSystem>;
}

export const FileSystemDescriptor: ServiceDescriptor<IBrudFileSystem, BrudFileSystem> =
  createFileSystemDescriptor();
