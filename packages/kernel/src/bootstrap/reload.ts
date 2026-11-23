import type { BrudKernel } from '../engine/BrudKernel.js';
import { BrudConfigError, type BrudConfig } from './config/types.js';

/** Options for {@link ReloadableKernel.reload}. */
export interface ReloadOptions {
  /** Config to load. Defaults to the path the running kernel booted from. */
  readonly configPath?: string;
}

/** A kernel the host can reload. Only the host holds it; no participant receives it. */
export type ReloadableKernel = BrudKernel & {
  /**
   * Replaces the running composition with the one in a config file: it
   * checks the new config against the frozen part, composes it, shuts this
   * kernel down, and boots the new one with the same options.
   *
   * Everything outside the frozen part may change: which participants exist,
   * their packages and their options. The frozen part is every official entry
   * in order, and the exposure owners; changing it needs a rebuild.
   *
   * @returns The new running kernel. This one is disposed.
   * @throws {BrudConfigError} `CONFIG_RELOAD_FROZEN` when the frozen part
   *   differs, or any config error the new composition raises. Nothing has
   *   been stopped in either case.
   * @throws {KernelReloadError} When the new kernel failed to boot after this
   *   one was stopped.
   * @throws {LifecycleStateError} When this kernel is not running.
   */
  reload(options?: ReloadOptions): Promise<ReloadableKernel>;
};

/** The new composition failed to boot after the running kernel was stopped. */
export class KernelReloadError extends Error {
  public readonly code = 'KERNEL_RELOAD_FAILED' as const;

  constructor(configPath: string, cause: unknown) {
    super(
      `Reload failed: the previous kernel was stopped and the composition in "${configPath}" did not boot: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = 'KernelReloadError';
  }
}

/** What a reload may not change: official entries in order, and exposure owners. */
function frozenPart(config: BrudConfig): { readonly official: readonly string[]; readonly owners: Readonly<Record<string, string>> } {
  return {
    official: config.services.filter((entry) => entry.official === true).map((entry) => entry.path),
    owners: Object.fromEntries(Object.entries(config.exposureOwners ?? {}).sort(([a], [b]) => a.localeCompare(b))),
  };
}

/**
 * Refuses a config whose frozen part differs from the booted one.
 *
 * @throws {BrudConfigError} `CONFIG_RELOAD_FROZEN`, naming every difference.
 */
export function refuseFrozenChange(booted: BrudConfig, next: BrudConfig, configPath: string): void {
  const before = frozenPart(booted);
  const after = frozenPart(next);
  const problems: string[] = [];

  for (const path of before.official) {
    if (!after.official.includes(path)) {
      problems.push(`official participant "${path}" was removed or is no longer official`);
    }
  }

  for (const path of after.official) {
    if (!before.official.includes(path)) {
      problems.push(`"${path}" is declared official but was not official at boot`);
    }
  }

  if (problems.length === 0 && before.official.join('\n') !== after.official.join('\n')) {
    problems.push('the order of the official participants changed');
  }

  if (JSON.stringify(before.owners) !== JSON.stringify(after.owners)) {
    problems.push('the exposure owners changed');
  }

  if (problems.length > 0) {
    throw new BrudConfigError(
      'CONFIG_RELOAD_FROZEN',
      `A reload cannot change what the build froze (${problems.join('; ')}). Rebuild to change official participants or exposure owners.`,
      configPath,
    );
  }
}
