import type { ServiceDescriptor } from '../contracts/serviceDescriptor.js';
import { LifecycleStateError } from './errors.js';

export class KernelRegistry {
  private readonly descriptors = new Map<string, ServiceDescriptor<unknown>>();
  private readonly instances = new Map<string, unknown>();
  private frozen = false;

  register<TService, TInternal extends TService = TService>(
    descriptor: ServiceDescriptor<TService, TInternal>,
  ): void {
    if (this.frozen) {
      throw new LifecycleStateError('register service after the registry was frozen');
    }

    this.descriptors.set(descriptor.token.id, descriptor as ServiceDescriptor<unknown>);
  }

  getDescriptor(tokenId: string): ServiceDescriptor<unknown> | undefined {
    return this.descriptors.get(tokenId);
  }

  getInstance(tokenId: string): unknown | undefined {
    return this.instances.get(tokenId);
  }

  setInstance(tokenId: string, instance: unknown): void {
    this.instances.set(tokenId, instance);
  }

  listDescriptors(): readonly ServiceDescriptor<unknown>[] {
    return Array.from(this.descriptors.values());
  }

  freeze(): void {
    this.frozen = true;
  }

  get isFrozen(): boolean {
    return this.frozen;
  }

  clearInstances(): void {
    this.instances.clear();
  }
}
