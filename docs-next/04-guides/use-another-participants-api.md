# Use another participant's API

**Goal:** call `acme.greet` from your own participant.

Inside a method, use `ctx.resolve`:

```js
const greeter = ctx.resolve('acme.greet');
if (!greeter) throw new Error('greeting is not available to me');
return greeter.greet('world').toUpperCase();
```

- `null` means the exposure does not exist **or** the giver refused you. You cannot tell which.
- Resolve lazily, inside a method. Before the kernel is `RUNNING`, `ctx.resolve` returns `null`.
- Use the handle inside the call. It stops working when the chain ends.

Working code: [`shout.mjs`](../examples/shout.mjs), [`shout.test.mjs`](../examples/shout.test.mjs).
