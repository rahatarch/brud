# Own a kind

**Goal:** make `[CALL note add]` in text reach your code.

The full, tested walkthrough is in [Own a kind and route text](../02-getting-started/own-a-kind-and-route-text.md). The short version:

1. Expose a dispatch API with `policy: { policyVersion: 2, official: true }`.
2. In `registerWithRouter(router)`, call `router.register({ kind, exposure, version })`.
3. Implement `dispatch(operation, context)`. Use `context.caller`, never anything in the request, to decide who is asking.
4. List the participant in your config as `official: true`.

Rules to remember: one owner per kind, and registration closes after admission. See [Kinds and the Brud syntax](../03-concepts/kinds-and-the-brud-syntax.md). Working code: [`notes.mjs`](../examples/notes.mjs).
