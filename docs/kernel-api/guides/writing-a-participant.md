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

### Finding out why `resolve` returned `null`
`registry.lastRefusal()` (or `ctx.lastRefusal()` with the SDK) tells you why the most recent `resolve` in the current call frame returned `null`, or returns `null` when it succeeded. It gives a stable `code`, a short `message` for your log, and your own `callerOrigin` and `callerClass`.

| Code | Meaning |
|---|---|
| `no-call-context` | There is no active kernel call. Exposures are not attached yet, so every `resolve` in a synchronous `create` is refused. Resolve in `onRunning` or later. |
| `registry-closed` | The resolution primitive has shut down. |
| `limit-exceeded` | Too many calls in the window, or the request was too large. |
| `malformed-request` | The name or version is malformed. |
| `unavailable` | The exposure is not available to you. It may not exist, or its policy may not admit your origin, class or capabilities. For example, a call that started in the host cannot resolve a `runtime`-scoped exposure. |

`unavailable` is deliberately a single answer: a refusal never tells you whether an exposure exists, or what its policy requires. The detail stays on the kernel's observation stream.

## Owning a kind (Brud syntax)
Kinds are the public vocabulary remote clients use: `[CALL <kind> <operation>]`. The Parser reads the text, the Router sends the operation to the kind's owner, and the owner decides what to do with it. A kind has one owner per composition; a second claim refuses the boot.

```ts
manifest: {
  requests: { capabilities: [] },
  exposures: [{ name: 'acme.photo.dispatch', version: 1, scope: 'any', policy: { policyVersion: 2, official: true } }],
  kinds: [{
    kind: 'photo',
    exposure: 'acme.photo.dispatch',          // must be one of your own exposures
    description: 'Edit images in the library',   // optional, public
    permission: { policyVersion: 2 },           // default for operations that declare none
    operations: {                               // required: every operation the kind serves
      resize: {
        description: 'Resize an image',         // optional, public
        input: { type: 'object', properties: { width: { type: 'number' } } },  // optional, public
      },
      publish: { permission: { policyVersion: 2, capabilities: ['photo:publish'] } },  // its own permission
    },
  }],
},
```
The dispatch exposure provides `dispatch(operation, context)`. Clients list kinds through the Router (`syntax.route` → `kinds()`), which returns each kind with its declared description and operations. The permissions are not listed.

### Operations and permissions
The kernel keeps a registry of the operations under each kind and the permission to call each one, and refuses a call **before your handler is reached**.
- **Every operation is declared.** A kind with no `operations` refuses the boot. A call to a name you did not list comes back with status `operation_not_declared`.
- **Every operation has a permission.** It is its own `permission`, or the kind's `permission` as a default. A kind or operation with neither refuses the boot. `{ policyVersion: 2 }` is the explicit "every routing caller".
- **The permission is a Layer 1 policy**, the same language as an exposure's `policy`: `origins`, `callerClasses`, `capabilities`, `official`. `parentCallerClasses` is not supported here. A caller the permission does not admit gets status `permission_denied`; what the permission required is never returned to the caller, and the kernel records the reason on its observation stream.
- **If you define the operation names yourself at runtime** (for example from a registry that plugins fill), write `operations: 'open'` and give the kind a `permission`. The kernel then enforces that one permission on every call and cannot check the names: your handler decides which names exist. An open kind is listed as `open: true` with no operation names.

What lives inside a kind is the owner's business: other participants contribute through the owner's own API, and by convention an owner may answer a `describe` operation (`[CALL photo describe]`, declared like any other) listing what its kind offers right now.

## Checklist
- Declare everything in the manifest; unknown keys refuse the boot (`PARTICIPANT_MANIFEST_INVALID`).
- Exposure bindings are keyed `name@major`.
- Read the real caller from the projection factory's `caller` argument, not from inside the method.
- Pass only plain JSON values across exposures if caged participants may call you.
- Kind descriptions are public, plain JSON; key anything about a caller by `caller.identity`.
- Match errors on their stable `code` ([error codes](../catalogue/error-codes.md)).
