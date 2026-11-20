import type { IKernelAccessBroker, ServiceInfo } from '../contracts/accessBroker.js';
import type { ServiceContext } from '../contracts/lifecycle.js';
import type { KernelCallContext } from '../contracts/callChain.js';
import {
  AllowlistViolationError,
  BlacklistedAccessViolationError,
  CallerIdentityMismatchError,
} from '../contracts/policy.js';
import type { ServiceToken } from '../contracts/serviceToken.js';
import type { KernelRegistry } from './KernelRegistry.js';
import { LifecycleStateError, ServiceNotFoundError } from './errors.js';
import type { KernelLifecycleState } from './state.js';

export type KernelStateChecker = () => KernelLifecycleState;

function matchesCaller(entry: string | ServiceToken<unknown>, callerId: string): boolean {
  return typeof entry === 'string' ? entry === callerId : entry.id === callerId;
}

/** The call-chain view the broker binds token access to. */
export interface KernelAccessAuthority {
  current(): KernelCallContext | undefined;
  tokenIdOf(identity: string): string | undefined;
  callerForToken(tokenId: string): unknown;
}

export class KernelAccessBroker implements IKernelAccessBroker {
  private readonly registry: KernelRegistry;

  private readonly readState: KernelStateChecker;

  private paused = false;

  private readonly authority: KernelAccessAuthority | undefined;

  constructor(registry: KernelRegistry, readState: KernelStateChecker, authority?: KernelAccessAuthority) {
    this.registry = registry;
    this.readState = readState;
    this.authority = authority;
  }

  /**
   * Binds the asserted caller id to the active call chain.
   *
   * - Kernel frames (hardcores, kernel work): trusted as before.
   * - Participant frames with a kernel-issued identity: the caller id must be
   *   the participant's own token id or kernel identity; anything else is
   *   refused. Unidentified frames (no identity registry) are unchanged.
   * - Host frames: may not claim `kernel` or a live participant.
   * - No active chain (host process code outside any chain): unchanged.
   */
  private assertCallerBinding(caller: ServiceContext, targetServiceId: string): void {
    const context = this.authority?.current();

    if (context === undefined || context.caller.callerClass === 'kernel') {
      return;
    }

    if (context.caller.callerClass === 'participant') {
      const identity = context.caller.identity;

      // No kernel-issued identity in this composition (no identity registry):
      // there is nothing to bind to, so the asserted id is taken as before.
      if (identity === null) {
        return;
      }

      const bound = this.authority?.tokenIdOf(identity);

      if (bound === undefined || (caller.callerId !== bound && caller.callerId !== identity)) {
        throw new CallerIdentityMismatchError(caller.callerId, targetServiceId, bound);
      }

      return;
    }

    if (caller.callerId === 'kernel' || this.authority?.callerForToken(caller.callerId) !== undefined) {
      throw new CallerIdentityMismatchError(caller.callerId, targetServiceId, undefined);
    }
  }

  /**
   * Suspends the lifecycle gate for a bounded boot-window operation.
   *
   * The kernel composition uses this around the boot pinner so any service
   * module's `pinBootPolicies` hook can ingest its boot snapshot before the
   * kernel announces RUNNING. The rule is general: it is available to every
   * participant on the same terms. Access policies, denial lists, and
   * allowlists still apply, so a pause cannot widen anyone's authority; it
   * only removes the "broker is idle" guard.
   *
   * @param operation - Work performed while the gate is suspended.
   */
  async withLifecycleGateSuspended<T>(operation: () => Promise<T>): Promise<T> {
    this.paused = true;

    try {
      return await operation();
    } finally {
      this.paused = false;
    }
  }

  requestAccess<TService>(caller: ServiceContext, token: ServiceToken<TService>): TService {
    const state = this.readState();
    if (state !== 'RUNNING' && !this.paused) {
      throw new LifecycleStateError('requestAccess', state, 'RUNNING');
    }

    const descriptor = this.registry.getDescriptor(token.id);
    if (descriptor === undefined) {
      throw new ServiceNotFoundError(token.id);
    }

    const instance = this.registry.getInstance(token.id);
    if (instance === undefined) {
      throw new ServiceNotFoundError(token.id);
    }

    this.assertCallerBinding(caller, token.id);

    const policy = descriptor.accessPolicy;
    if (policy?.deniedCallers?.some((entry) => matchesCaller(entry, caller.callerId))) {
      throw new BlacklistedAccessViolationError(
        caller.callerId,
        token.id,
        'caller is explicitly denied by the service access policy',
      );
    }

    if (
      policy?.allowedCallers !== undefined
      && !policy.allowedCallers.some((entry) => matchesCaller(entry, caller.callerId))
    ) {
      throw new AllowlistViolationError(caller.callerId, token.id);
    }

    if (descriptor.project !== undefined) {
      return descriptor.project(instance, caller) as TService;
    }

    return instance as TService;
  }

  hasService(token: ServiceToken<unknown>): boolean {
    return this.registry.getDescriptor(token.id) !== undefined;
  }

  listServices(): readonly ServiceInfo[] {
    return this.registry.listDescriptors().map((descriptor) => ({
      id: descriptor.token.id,
      description: descriptor.token.description,
      tier: descriptor.tier,
      initialized: this.registry.getInstance(descriptor.token.id) !== undefined,
    }));
  }
}
