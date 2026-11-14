import { fileURLToPath } from 'node:url';
import type { KernelLogger } from '../../contracts/lifecycle.js';
import { createDeferredKernel } from '../../bootstrap/bootKernelInternal.js';
import type { BrudKernel } from '../../engine/BrudKernel.js';

/**
 * Test-harness setup helper: builds an unbooted kernel from an explicit config.
 *
 * The kernel itself never chooses or discovers a config. The test harness is a
 * host, and as a host it supplies the path explicitly: the composition the test
 * runner provides through `BRUD_STANDARD_CONFIG`, or else the kernel package's
 * own hardcore-only config. This is a setup helper that wires the real
 * {@link createDeferredKernel}; it substitutes nothing.
 *
 * @param options - Flat options merged into the generic bag, or `options` and
 * `logger` in the canonical shape.
 */
export function createStandardKernel(
  options: Readonly<Record<string, unknown>> & {
    readonly options?: Readonly<Record<string, unknown>>;
    readonly logger?: unknown;
  } = {},
): BrudKernel {
  const { options: nestedOptions, logger, ...flatOptions } = options;
  const supplied = process.env.BRUD_STANDARD_CONFIG;
  const configPath = typeof supplied === 'string' && supplied.length > 0
    ? supplied
    : fileURLToPath(new URL('../../../brud.config.json', import.meta.url));

  return createDeferredKernel(configPath, {
    options: { ...(nestedOptions ?? {}), ...flatOptions },
    ...(logger === undefined ? {} : { logger: logger as KernelLogger }),
  });
}
