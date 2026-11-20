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

A participant claims a kind during boot and points it at one of its **own** exposures that provides `dispatch(operation, context)`.

```js
registerWithRouter(router) {
  router.register({ kind: 'note', exposure: 'acme.notes.dispatch', version: 1 });
}
```

Rules:

- One owner per kind. A second claim is refused.
- Registration closes after boot's admission step.
- The dispatch exposure should require `official: true`, because the Router passes it a caller view it trusts.

## What the Router does

For each operation it resolves your dispatch exposure on the current chain and calls `dispatch(operation, context)`. `context.caller` is the real caller the Router captured. The request text cannot supply or change it. You get one outcome per operation in the result.

## Try it

Full code: [Own a kind and route text](../02-getting-started/own-a-kind-and-route-text.md), using [`notes.mjs`](../examples/notes.mjs) and [`route-notes.mjs`](../examples/route-notes.mjs).

From a host, `registry.resolve('syntax.route')` gives `route(text)` and `kinds()`. `syntax.parse@1` parses without dispatching.

**Next:** [Events](events.md)
