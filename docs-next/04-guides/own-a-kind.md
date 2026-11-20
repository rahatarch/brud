# Own a kind

Let text commands such as `[CALL note add]` reach your code by claiming an operation kind.

## Before you begin

- Complete [Own a kind and route text](../02-getting-started/own-a-kind-and-route-text.md). This guide is the short version of that tutorial.
- Your participant must be listed in your config with `official: true`.

## Steps

1. **Expose a dispatch API.** Give the exposure a policy that requires `official: true`, because the Router passes it a caller view it trusts.

   ```js
   policy: { policyVersion: 2, official: true }
   ```

2. **Register the kind.** Do this in `registerWithRouter(router)`.

   ```js
   router.register({ kind: 'note', exposure: 'acme.notes.dispatch', version: 1 });
   ```

3. **Implement `dispatch(operation, context)`.** Decide who is asking from `context.caller`. Never use anything from the request text. `context.caller.capabilities` is a sorted `string[]` here (use `.includes`), unlike the `Set` that policies see; see [Identity and the call chain](../03-concepts/identity-and-call-chain.md).

## Rules

- Each kind has one owner. A second claim fails with `ROUTER_KIND_COLLISION`.
- Registration closes after admission. A late claim fails with `ROUTER_REGISTRATION_CLOSED`.

The tested code is in [`notes.mjs`](../examples/notes.mjs) and [`route-notes.mjs`](../examples/route-notes.mjs).

## Next steps

- [Kinds and the Brud syntax](../03-concepts/kinds-and-the-brud-syntax.md)
- [Gate access with capabilities](gate-access-with-capabilities.md)
