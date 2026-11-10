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
 * under `options` (the canonical shape). Plugin overrides are translated into
 * the bag before the kernel sees them.
 */
export interface CreateStandardKernelOptions extends ComposeKernelOptions {
  /**
   * Legacy flat service options; merged into the generic bag.
   *
   * The wrapper recognizes the compatibility keys `initialPlugins` and
   * `certifyInitialPlugins` and translates them into the bag. They are not
   * named properties of a core boot boundary.
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
    bag['plugins'] = initialPlugins;
  }

  if (certifyInitialPlugins !== undefined) {
    bag['certifyPlugins'] = certifyInitialPlugins;
  }

  return createDeferredKernel(defaultKernelConfigPath(), {
    options: bag,
    ...(logger === undefined ? {} : { logger: logger as KernelLogger }),
  });
}

function defaultKernelConfigPath(): string {
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