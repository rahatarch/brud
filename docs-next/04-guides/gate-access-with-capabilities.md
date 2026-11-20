# Gate access with capabilities

Give each caller only the methods its capabilities allow. A caller with `vault:read` can read, a caller with `vault:write` can write, and any other caller gets nothing.

## Before you begin

Know the difference between scope, policy and projection. See [Exposures, scope and policy](../03-concepts/exposures-scope-and-policy.md).

## Steps

1. **Wrap the handle in `byCapability`.** Each key is a capability. Each value builds the part of the handle that capability unlocks.

   ```js
   handle: byCapability({
     'vault:read':  (ctx) => ({ read: () => ctx.instance.secret }),
     'vault:write': (ctx) => ({ write: (v) => { ctx.instance.secret = v; } }),
   })
   ```

   A caller receives the combination of every part it qualifies for. If it qualifies for none, `resolve` returns `null`.

2. **Declare the capability on the caller.** A participant lists capabilities in its own manifest. A host passes them to `runHostCall`.

3. **Test every combination.** Use `bootTestKernel` to boot a real kernel and assert what each caller can do.

The complete code is in [`vault.mjs`](../examples/vault.mjs) and [`vault.test.mjs`](../examples/vault.test.mjs).

> **Note**
> The giver decides what a capability means. A capability is only a name until a giver acts on it.

## Next steps

- [Test your participant](../02-getting-started/test-your-participant.md)
- [Handle errors](handle-errors.md)
