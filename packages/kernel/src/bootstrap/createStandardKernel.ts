import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { KernelLogger } from '../contracts/lifecycle.js';
import type { BrudKernel } from '../engine/BrudKernel.js';
import type { ComposeKernelOptions } from './bootTypes.js';
import { createDeferredKernel } from './bootKernelInternal.js';

/**
 * Compatibility options for the config-backed standard kernel.
 *
 * The old hardcoded composition is gone; this wrapper selects the kernel's
 * default config. It exists because read-only plugin test harnesses still
 * import `createStandardKernel` from `@brud/kernel`.
 *
 * The generic options bag can be supplied either flat (legacy embedders) or
 * under `options` (the canonical shape). Legacy host option names are mapped
 * into the namespace owned by the service that interprets them; the kernel
 * itself carries no plugin concept.
 */
export interface CreateStandardKernelOptions extends ComposeKernelOptions {
  /**
   * Legacy flat service options; merged into the generic bag.
   *
   * The wrapper recognizes the compatibility keys `initialPlugins` and
   * `certifyInitialPlugins` and maps them into the plugin manager's own
   * namespace. They are not named properties of a core boot boundary.
   */
  readonly [option: string]: unknown;
}

/**
 * Builds an unbooted kernel from the kernel's default config.
 *
 * @param options - Generic options bag, logger, and plugin overrides.
 */
export function createStandardKernel(
  options: CreateStandardKernelOptions = {},
): BrudKernel {
  const {
    options: nestedOptions,
    logger,
    initialPlugins,
    certifyInitialPlugins,
    ...flatOptions
  } = options;
  const bag: Record<string, unknown> = {
    ...(nestedOptions ?? {}),
    ...flatOptions,
  };

  if (initialPlugins !== undefined) {
    bag['pluginManager.plugins'] = { entries: initialPlugins };
  }

  if (certifyInitialPlugins !== undefined) {
    bag['pluginManager.certifyPlugins'] = certifyInitialPlugins;
  }

  const configPath = defaultKernelConfigPath();

  if (bag['pluginManager.configPath'] === undefined) {
    bag['pluginManager.configPath'] = configPath;
  }

  return createDeferredKernel(configPath, {
    options: bag,
    ...(logger === undefined ? {} : { logger: logger as KernelLogger }),
  });
}

function defaultKernelConfigPath(): string {
  // The host chooses the composition. Tests and embedders that ship their own
  // standard set point this variable at their config; the kernel package only
  // ships its hardcore-only default config.
  const override = process.env.BRUD_STANDARD_CONFIG;

  if (typeof override === 'string' && override.length > 0) {
    if (!existsSync(override)) {
      throw new Error(
        `BRUD_STANDARD_CONFIG points at a missing config: ${override}`,
      );
    }

    return override;
  }

  const candidates = [
    fileURLToPath(new URL('../../brud.config.json', import.meta.url)),
    fileURLToPath(new URL('../../../brud.config.json', import.meta.url)),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));

  if (found === undefined) {
    throw new Error(
      `Kernel default config not found; looked in: ${candidates.join(', ')}`,
    );
  }

  return found;
}