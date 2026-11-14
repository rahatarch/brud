import type { ExposureDeclaration } from '../../../src/contracts/manifest.js';
import type { ExposedApiResolveOptions } from './types.js';

/**
 * The resolution primitive, as every participant sees it.
 *
 * `resolve` is open to every participant in the composition. It takes no
 * caller list and applies no policy of its own: it reads the caller and the
 * chain's root origin from the kernel-provided execution context and evaluates
 * the giver's declared Layer 1 policy.
 */
export interface IExposedApiRegistry {
  /**
   * Resolves an exposure for the current caller.
   *
   * Layer 1 is evaluated here, to decide whether the caller may see the
   * exposure, and again on every use of the returned handle, against the root
   * origin of the chain using it. A handle is a reference, not a grant.
   *
   * A caller the policy does not permit receives exactly what it would receive
   * for an exposure that does not exist: `null`. The detailed reason goes to
   * the kernel's observation stream.
   *
   * @param name - Exposure name.
   * @param options - Version and expected owner identity.
   * @returns The handle, or `null`.
   */
  resolve<T = unknown>(name: string, options?: ExposedApiResolveOptions): T | null;
}

/**
 * Registration, as only the kernel sees it.
 *
 * The kernel calls `register` during admission, on each participant's behalf,
 * from that participant's manifest. It is never part of the view a participant
 * receives, and it is refused for everyone once the boot window seals.
 */
export interface IExposedApiAdmission {
  /**
   * Registers one declared exposure for its owner.
   *
   * @param owner - Kernel-issued identity token of the declaring participant.
   * @param declaration - The exposure exactly as the manifest declares it.
   */
  register(owner: string, declaration: ExposureDeclaration): void;
}
