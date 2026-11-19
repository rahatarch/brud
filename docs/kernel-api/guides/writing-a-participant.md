# Writing a participant

A participant is an ES module exporting `createService()`, which returns a **service descriptor**. The kernel loads it from the composition config (`brud.config.json`: `{ "services": [{ "path": "…", "official": false }] }`; entry keys are `path` and `official` only).

```ts
import {
  ExposedApiRegistryToken,
  createServiceToken,
  withExposureBindings,
  type IExposedApiRegistry,
  type IKernelAccessBroker,
  type IServiceLifecycle,
  type ServiceDescriptor,
} from '@brud/kernel';

interface IGreeter { greet(name: string): string }

const GreeterToken = createServiceToken<IGreeter>('acme.greeter');

export function createService(): ServiceDescriptor<IGreeter> {
  return {
    token: GreeterToken,
    tier: 'userland',
    dependencies: [],
    // The manifest is declarative data, validated and frozen at admission.
    manifest: {
      requests: { capabilities: [] },
      exposures: [{ name: 'acme.greet', version: 1, scope: 'any' }],
    },
    factory: () => {
      const instance: IGreeter & IServiceLifecycle = {
        greet: (name: string): string => `hello, ${name}`,
        // Lifecycle hooks run on a `runtime` chain as this participant; the
        // broker grants access in onRunning (not during initialize).
        onRunning(broker: IKernelAccessBroker): void {
          const registry: IExposedApiRegistry = broker.requestAccess(
            { callerId: GreeterToken.id, tier: 'userland', options: {} },
            ExposedApiRegistryToken,
          );
          void registry; // resolve other givers' exposures here
        },
      };

      // Bind each exposure (`name@major`) to its projection. The projection
      // receives the real caller's view at resolve time.
      return withExposureBindings(instance, {
        'acme.greet@1': { projection: (_service, caller) => ({
          greet: (name: string) => `${instance.greet(name)} (from ${String(caller.identity)})`,
        }) },
      });
    },
  };
}
```

## Using another giver's API
```ts
const greeter = registry.resolve<{ greet(name: string): string }>('acme.greet');
if (greeter !== null) greeter.greet('world');
```
`resolve` returns `null` when scope or policy refuses you. Hold the handle and call it later; each call is re-checked against the chain that makes it.

## Checklist
- Declare everything in the manifest; unknown keys refuse the boot (`PARTICIPANT_MANIFEST_INVALID`).
- Exposure bindings are keyed `name@major`.
- Read the real caller from the projection factory's `caller` argument, not from inside the method.
- Pass only plain JSON values across exposures if caged participants may call you.
- Match errors on their stable `code` ([error codes](../catalogue/error-codes.md)).
