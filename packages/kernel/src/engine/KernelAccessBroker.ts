import type { IKernelAccessBroker, ServiceInfo } from '../contracts/accessBroker.js';
import type { ServiceContext } from '../contracts/lifecycle.js';
import { AllowlistViolationError, BlacklistedAccessViolationError } from '../contracts/policy.js';
import type { ServiceToken } from '../contracts/serviceToken.js';
import type { KernelRegistry } from './KernelRegistry.js';
import { LifecycleStateError, ServiceNotFoundError } from './errors.js';
import type { KernelLifecycleState } from './state.js';

export type KernelStateChecker = () => KernelLifecycleState;

function matchesCaller(entry: string | ServiceToken<unknown>, callerId: string): boolean {
  return typeof entry === 'string' ? entry === callerId : entry.id === callerId;
}

export class KernelAccessBroker implements IKernelAccessBroker {
  private readonly registry: KernelRegistry;

  private readonly readState: KernelStateChecker;

  private paused = false;

  constructor(registry: KernelRegistry, readState: KernelStateChecker) {
    this.registry = registry;
    this.readState = readState;
  }

  /**
   * Suspends the lifecycle gate for a bounded internal operation.
   *
   * The kernel composition uses this exactly once, at the end of boot, to let
   * a service ingest its frozen boot snapshot before the kernel announces
   * RUNNING. Access policies, denial lists and allowlists still apply, so a
   * pause cannot widen anyone's authority; it only removes the
   * "broker is idle" guard.
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
