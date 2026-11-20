import type { BrudKernel, ServiceContext, ServiceToken } from '@brud/kernel';

/** Capabilities a host session in these tests holds. */
const HOST_CAPABILITIES = ['fs:read', 'fs:write', 'workspace:read', 'validation:read', 'history:read', 'history:write'];

/**
 * Production mirror: returns the service a host reaches by token, with every
 * method call run inside a host call chain (`kernel.runHostCall`), as the
 * daemon does. Calls into other participants' exposures are then checked
 * against that chain.
 */
export function hostAccess<T extends object>(kernel: BrudKernel, caller: ServiceContext, token: ServiceToken<T>): T {
  const raw = kernel.requestAccess(caller, token);

  return new Proxy(raw, {
    get: (target, property): unknown => {
      const member = Reflect.get(target, property, target) as unknown;

      return typeof member === 'function'
        ? (...args: unknown[]): unknown => kernel.runHostCall(
          { capabilities: HOST_CAPABILITIES },
          () => Reflect.apply(member as (...a: unknown[]) => unknown, target, args),
        )
        : member;
    },
  });
}
