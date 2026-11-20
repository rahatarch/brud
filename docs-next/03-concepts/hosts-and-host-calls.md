# Hosts and host calls

A **host** is the program that boots the kernel and drives it: a CLI, a server, a desktop app, a test. The host is not a participant. It has no manifest and no identity in the registry. It enters the kernel through one entry point, the **host call**.

## The host call

```js
const result = await kernel.runHostCall({ capabilities: [] }, async () => {
  // Inside this callback, a call chain exists with origin "host".
  const registry = kernel.requestAccess(
    { callerId: 'my.host', tier: 'core', options: {} },
    ExposedApiRegistryToken,
  );
  const greeter = registry.resolve('acme.greet');
  return greeter?.greet('world');
});
```

What the kernel does for you:

- Opens a call chain whose **origin is `host`** and whose caller class is `host`.
- Attaches the capabilities you pass in `capabilities`.
- Closes the chain when the callback ends. Handles resolved inside stop working after that.

A working version is in [`boot-greeter.mjs`](../examples/boot-greeter.mjs).

## Why the origin matters

Scope is checked against the chain's root origin. An exposure with scope `runtime` never admits a chain that began at the host. An exposure with scope `host` admits only host chains. Use `any` for what both should reach. See [Exposures, scope and policy](exposures-scope-and-policy.md).

## Capabilities on the host

`capabilities` is the list the host declares for itself for this call. Giver policies and projections read it exactly as they read a participant's. Pass only what this call needs.

## Rules of thumb

- Do all work that needs handles **inside** the callback. A handle used after the callback ends throws `EXPOSED_API_UNAVAILABLE`.
- One host call is one chain. Nested calls from participants extend it, they do not start a new one.
- Shut the kernel down when you are done.

**Next:** [Kinds and the Brud syntax](kinds-and-the-brud-syntax.md)
