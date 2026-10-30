import { realpathSync } from 'node:fs';
import type { IStorageDriver } from '../../drivers/contracts/index.js';
import { createFileSystemDescriptor } from '../../services/BrudFileSystem/descriptor/descriptor.js';
import { DurableNodeStorageDriver } from '../../services/BrudFileSystem/drivers/DurableNodeStorageDriver.js';
import { createFileMutationJournal } from '../../services/BrudFileSystem/events/FileMutationJournal.js';
import type { IFileMutationJournal } from '../../services/BrudFileSystem/events/types.js';
import { HISTORY_TRUSTED_SCOPE } from '../../services/BrudFileSystem/security/protectedPaths.js';
import {
  createBrudToolsDescriptor,
  type BrudToolsDescriptorOptions,
} from '../../services/BrudTools/descriptor/BrudToolsDescriptor.js';
import type { IBrudPlugin } from '../../services/PluginManager/contracts/IBrudPlugin.js';
import { createPluginManagerDescriptor } from '../../services/PluginManager/descriptor/index.js';
import {
  createSettingsDescriptor,
  createSettingsReaderDescriptor,
  type SettingsDescriptorOptions,
} from '../../services/SettingsService/descriptor/descriptor.js';
import {
  createHistoryDescriptor,
  HISTORY_CALLER_ID,
  type HistoryDescriptorOptions,
} from '../../services/UniversalHistory/descriptor/index.js';
import {
  createUniversalHistoryDescriptor,
  type UniversalHistoryDescriptorOptions,
} from '../../services/UniversalHistory/descriptor/index.js';
import {
  createTerminalDescriptor,
  pinTerminalPolicies,
  type TerminalDescriptorOptions,
} from '../../services/TerminalService/descriptor/TerminalDescriptor.js';
import {
  createValidationDescriptor,
  pinBootPolicies,
  type ValidationDescriptorOptions,
} from '../../services/ValidationService/descriptor/ValidationDescriptor.js';
import { createUnifiedHistoryDescriptors } from '../../services/UniversalHistory/unified/descriptor/unifiedHistoryDescriptors.js';
import type { WorkspaceService } from '../../services/WorkspaceService/orchestrator/WorkspaceService.js';
import {
  createWorkspaceDescriptor,
  type WorkspaceDescriptorOptions,
} from '../../services/WorkspaceService/descriptor/descriptor.js';
import type { KernelBootOptions } from '../contracts/kernel.js';
import type { IServiceLifecycle } from '../contracts/lifecycle.js';
import type { KernelLogger } from '../contracts/lifecycle.js';
import { BrudKernel } from '../engine/BrudKernel.js';

/** Fallback diagnostic sink used when the host does not supply one. */
const DEFAULT_KERNEL_LOGGER: KernelLogger = {
  warn: (message, meta) => {
    console.warn(message, meta ?? {});
  },
};

/**
 * Options accepted by {@link createStandardKernel}.
 */
export interface CreateStandardKernelOptions {
  /** Storage backend backing the file system service. Defaults to the node driver. */
  readonly storageDriver?: IStorageDriver;
  /**
   * History ledger overrides. Defaults to `.brud/history/ledger.db` inside
   * the boot workspace.
   */
  readonly history?: UniversalHistoryDescriptorOptions;
  /**
   * History engine. `'unified'` (default since D-15 U-6) serves both history
   * tokens from the unified polymorphic engine and imports legacy history on
   * first boot. `'legacy'` keeps the session ledger and the journal as two
   * engines; it remains selectable only as a rollback switch until U-7.
   */
  readonly historyEngine?: 'legacy' | 'unified';
  /**
   * Journal-driven history overrides. Defaults to `.brud/history/history.db`
   * inside the boot workspace and consumes the shared mutation journal.
   *
   * When {@link history} requests an in-memory ledger and this option is
   * omitted, the journal ledger also defaults to `:memory:` so ephemeral
   * kernels do not write to the host filesystem.
   */
  readonly historyJournal?: HistoryDescriptorOptions;
  /**
   * Settings store, defaults, or warning sink overrides. Defaults to the
   * filesystem-backed `~/.brud/settings.json` and
   * `<workspace>/.brud/settings.json` scopes.
   */
  readonly settings?: SettingsDescriptorOptions;
  /**
   * Workspace root registry, path flavor, and warning sink overrides.
   *
   * Defaults to a single root taken from `kernel.boot({ workspaceRoot })`
   * and the canonical `realpath` of that root resolved at boot.
   */
  readonly workspace?: WorkspaceDescriptorOptions;
  /**
   * Validation policy, workspace, flavor and home overrides.
   *
   * By default the service ingests the frozen boot settings snapshot and the
   * `brud.core.workspace` authority. Overrides exist for standalone
   * compositions and tests only.
   */
  readonly validation?: ValidationDescriptorOptions;
  /**
   * Terminal policy, validator and workspace overrides.
   *
   * By default the service freezes the standard policy, re-validates every
   * command through `brud.core.validation`, and spawns under the boot
   * workspace root. Overrides exist for standalone compositions and tests.
   */
  readonly terminal?: TerminalDescriptorOptions;
  /**
   * BrudTools validator and logger overrides.
   *
   * By default the service resolves `brud.core.validation` lazily on first
   * dispatch. Overrides exist for standalone compositions and tests only.
   */
  readonly tools?: BrudToolsDescriptorOptions;
  /**
   * Mutation journal the filesystem publishes pre/post descriptors to.
   *
   * Phase 4 (`UniversalHistory`) binds a listener here. When omitted, the
   * filesystem keeps a private journal that stays disabled until a listener
   * subscribes through the service instance.
   */
  readonly mutationJournal?: IFileMutationJournal;
  /**
   * Plugins registered into the plugin manager before the kernel boots.
   *
   * Registration is passive. The plugins are activated during the boot
   * sequence, after the filesystem and history services have initialized.
   */
  readonly initialPlugins?: readonly IBrudPlugin[];
  /**
   * Kernel diagnostic sink forwarded to every service context. Defaults to a
   * console-backed sink so background failures (history ingestion, degraded
   * read-only storage) are never fully silent.
   */
  readonly logger?: KernelLogger;
}

/**
 * Canonicalizes the boot workspace root before any service is constructed.
 *
 * `WorkspaceService.primaryRoot` and the filesystem's bound root must be the
 * same string, otherwise a workspace reached through a symbolic link yields two
 * different notions of "inside". The boot root is therefore resolved once here
 * and handed to every descriptor through `ServiceContext.workspaceRoot`; the
 * filesystem then binds to the workspace authority's canonical root.
 *
 * Roots that only exist inside a virtual driver (an in-memory root such as
 * `/workspace`) do not resolve on the host and keep their declared form; the
 * workspace service still canonicalizes them through its own port.
 *
 * @param workspaceRoot - Declared boot workspace root.
 * @returns The host-canonical root when it exists, otherwise the declared root.
 */
function canonicalizeBootRoot(workspaceRoot: string): string {
  try {
    return realpathSync(workspaceRoot);
  } catch {
    return workspaceRoot;
  }
}

/**
 * Builds an unbooted kernel with the standard core services registered.
 *
 * The returned kernel accepts additional service registrations before
 * {@link BrudKernel.boot} is called.
 *
 * Boot order is structural: settings, settings reader, workspace, filesystem,
 * validation, terminal, history, then plugins. Workspace precedes the filesystem service so the
 * canonical root identity exists before any content service initializes.
 *
 * @param options - Optional driver, workspace, history, and plugin overrides for testing or alternate backends.
 * @returns A kernel instance ready to boot.
 */
export function createStandardKernel(options?: CreateStandardKernelOptions): BrudKernel {
  // Validation freezes its policy from the settings snapshot and the workspace
  // authority; terminal binds the validation gate it re-checks every command
  // against. Both dependencies are only readable once the broker serves
  // requests, which is why the kernel runs the registered boot pinners at the
  // end of boot.
  const kernel = new BrudKernel({
    bootPinner: async (instances: readonly IServiceLifecycle[]): Promise<void> => {
      await pinBootPolicies(instances);
      pinTerminalPolicies(instances);
    },
  });
  const storageDriver = options?.storageDriver ?? new DurableNodeStorageDriver();
  // One journal instance is shared by the filesystem and the journal-driven
  // history service. When the host does not provide one, the bootstrap owns it
  // so history can observe every mutation from the first boot.
  const mutationJournal = options?.mutationJournal ?? createFileMutationJournal();
  const historyJournalOptions: HistoryDescriptorOptions = options?.historyJournal
    ?? (options?.history?.inMemory === true ? { inMemory: true } : {});
  kernel.register(createSettingsDescriptor(options?.settings));
  kernel.register(createSettingsReaderDescriptor());
  // Capture the workspace instance built by its descriptor so the filesystem
  // descriptor receives the same canonical authority instead of constructing
  // a second, divergent path model. Topological order guarantees the workspace
  // factory has run before the filesystem factory because the descriptor
  // declares `WorkspaceToken` as a dependency.
  const workspaceBinding: { instance?: WorkspaceService } = {};
  const workspaceDriver = options?.workspace?.driver ?? storageDriver;
  const workspaceDescriptor = createWorkspaceDescriptor({
    ...options?.workspace,
    driver: workspaceDriver,
  });

  kernel.register({
    ...workspaceDescriptor,
    factory: (context, broker) => {
      const instance = workspaceDescriptor.factory(context, broker);

      workspaceBinding.instance = instance;

      return instance;
    },
  });
  kernel.register(createFileSystemDescriptor({
    driver: workspaceDriver,
    mutationJournal,
    trustedWriteScopesByCaller: {
      [HISTORY_TRUSTED_SCOPE.owner]: [HISTORY_TRUSTED_SCOPE.prefix],
      [HISTORY_CALLER_ID]: [HISTORY_TRUSTED_SCOPE.prefix],
    },
    workspace: () => {
      const instance = workspaceBinding.instance;

      if (instance === undefined) {
        throw new Error(
          'brud.core.workspace must be constructed before brud.core.filesystem',
        );
      }

      return instance;
    },
  }));
  // Validation sits after workspace (its containment authority) and before the
  // terminal and plugin layers. Its policy is the boot settings snapshot, read
  // once at construction and never re-read.
  kernel.register(createValidationDescriptor(options?.validation));
  // Terminal sits immediately after validation: it re-validates every command
  // (including conditional branches) through the frozen gate before spawning,
  // and owns the only process-spawn site in the kernel.
  kernel.register(createTerminalDescriptor(options?.terminal));
  // BrudTools (brud.core.tools) is the Level-1 tool routing table. It boots
  // after validation (its schema gate) and before the plugin manager, so the
  // registry is RUNNING before any plugin activates and registers into it.
  kernel.register(createBrudToolsDescriptor(options?.tools));
  if (options?.historyEngine !== 'legacy') {
    const unified = createUnifiedHistoryDescriptors({
      driver: storageDriver,
      journal: mutationJournal,
      ...(options?.history?.inMemory === true ? { inMemory: true } : {}),
    });
    kernel.register(unified.session);
    kernel.register(unified.journal);
  } else {
    kernel.register(createUniversalHistoryDescriptor(options?.history));
    kernel.register(createHistoryDescriptor({
      ...historyJournalOptions,
      journal: mutationJournal,
    }));
  }
  kernel.register(createPluginManagerDescriptor({
    initialPlugins: options?.initialPlugins,
    withUniversalHistory: true,
    withTools: true,
  }));

  const boot = kernel.boot.bind(kernel);
  kernel.boot = async (bootOptions: KernelBootOptions): Promise<void> =>
    boot({
      ...bootOptions,
      workspaceRoot: canonicalizeBootRoot(bootOptions.workspaceRoot),
      logger: bootOptions.logger ?? options?.logger ?? DEFAULT_KERNEL_LOGGER,
    });

  return kernel;
}
