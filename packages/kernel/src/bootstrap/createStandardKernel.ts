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
 * default config.
 *
 * The generic options bag can be supplied either flat (legacy embedders) or
 * under `options` (the canonical shape). Every service-specific value belongs
 * to the service that interprets it; the kernel only forwards the bag.
 */
export interface CreateStandardKernelOptions extends ComposeKernelOptions {
  /**
   * Legacy flat service options; merged into the generic bag.
   */
  readonly [option: string]: unknown;
}

/**
 * Builds an unbooted kernel from the kernel's default config.
 *
 * @param options - Generic options bag and logger.
 */
export function createStandardKernel(
  options: CreateStandardKernelOptions = {},
): BrudKernel {
  const {
    options: nestedOptions,
    logger,
    ...flatOptions
  } = options;
  const bag: Record<string, unknown> = {
    ...(nestedOptions ?? {}),
    ...flatOptions,
  };

  return createDeferredKernel(defaultKernelConfigPath(), {
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