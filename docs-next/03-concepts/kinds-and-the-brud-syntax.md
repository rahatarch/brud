# Kinds and the Brud syntax

Brud syntax is the text format an AI model (or any author) uses to ask for work. The kernel parses it and sends each operation to the participant that owns its **kind**.

## The format

```text
[BRUD]
[CALL note add]
text: buy milk
[END]
[CALL note list]
[END]
[/BRUD]
```

- `[BRUD]` ... `[/BRUD]` wraps a document. Prose outside it is ignored.
- `[CALL <kind> <name>]` starts an operation. `<kind>` selects the owner, `<name>` is the action.
- `key: value` lines are parameters. Values arrive as strings.
- `[END]` closes the operation.

The parser is **fail-closed**: a malformed document yields a failure and no partial operation list. A document can also exceed an operation limit (`OPERATION_LIMIT_EXCEEDED`).

Each parsed operation has `index`, `kind`, `name` and `parameters`, all read-only.

## Owning a kind

A participant claims a kind in its manifest (`manifest.kinds`, or via `defineParticipant({ kinds: [...] })`), pointing it at one of its **own** exposures that provides `dispatch(operation, context)`.

```js
kinds: [{
  kind: 'note',
  exposure: 'acme.notes.dispatch',
  version: 1,
  description: 'Keep short notes',
  permission: { policyVersion: 2 },
  operations: {
    add: { description: 'Add a note', input: { type: 'object', properties: { text: { type: 'string' } } } },
    list: { description: 'List every note' },
  },
}]
```

Rules:

- **Declare operations:** A kind must declare every operation it serves in `operations`, each with a permission of its own or the kind-level default. A kind whose operation names only exist at runtime declares `operations: 'open'` with a kind-level permission.
- **Declare permission:** Every operation needs a policy object (Layer 1 policy) governing who may invoke it (`permission`).
- **One owner per kind:** A second claim is refused with `ROUTER_KIND_COLLISION`.
- **Registration closes:** Registration closes after boot's admission step.
- The dispatch exposure should require `official: true`, because the Router passes it a caller view it trusts.

## What the Router does

Before dispatching to the owner, the Router verifies the operation and caller:
- If the operation is not declared in `operations`, the operation immediately receives `status: 'operation_not_declared'`.
- If the caller does not satisfy the declared permission, the operation receives `status: 'permission_denied'`.
- If the kind is unknown, it receives `status: 'kind_not_registered'`.

Only admitted operations reach the owner's dispatch exposure: the Router resolves your dispatch exposure on the current chain and calls `dispatch(operation, context)`. `context.caller` is the real caller the Router captured (`context.caller.capabilities` is a read-only view). The request text cannot supply or change it.

Terminal operation statuses are: `success`, `failed`, `skipped`, `aborted`, `kind_not_registered`, `operation_not_declared`, and `permission_denied`.

## Try it

Full code: [Own a kind and route text](../02-getting-started/own-a-kind-and-route-text.md), using [`notes.mjs`](../examples/notes.mjs) and [`route-notes.mjs`](../examples/route-notes.mjs).

From a host, `registry.resolve('syntax.route')` gives `route(text)` and `kinds()`. `syntax.parse@1` parses without dispatching.

**Next:** [Events](events.md)
