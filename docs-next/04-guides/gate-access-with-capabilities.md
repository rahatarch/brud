# Gate access with capabilities

**Goal:** callers with `vault:read` can read, callers with `vault:write` can write, others get nothing.

Use `byCapability` as the exposure's `handle`:

```js
handle: byCapability({
  'vault:read':  (ctx) => ({ read: () => ctx.instance.secret }),
  'vault:write': (ctx) => ({ write: (v) => { ctx.instance.secret = v; } }),
})
```

The caller gets the union of the handles it qualifies for, or `null`. Capabilities are declared by the caller in its own manifest (or by the host in `runHostCall`). The giver decides what each one means.

Full code and tests: [`vault.mjs`](../examples/vault.mjs), [`vault.test.mjs`](../examples/vault.test.mjs). Background: [Exposures, scope and policy](../03-concepts/exposures-scope-and-policy.md).
