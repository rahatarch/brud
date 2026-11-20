# Use another participant's API

Call an exposure that another participant offers, such as `acme.greet`.

## Before you begin

The other participant must be in the same composition, and its giver must admit you. If it does not, `resolve` returns `null`.

## Steps

1. **Resolve inside a method.** Call `ctx.resolve` when you need the API, not when your participant is constructed.

   ```js
   const greeter = ctx.resolve('acme.greet');
   if (!greeter) throw new Error('The greeting API is not available to this participant.');
   return greeter.greet('world').toUpperCase();
   ```

2. **Handle `null`.** It means the exposure does not exist or the giver refused you. You cannot tell which.

3. **Use the handle in the same call.** A handle stops working when its call chain ends.

> **Important**
> Before the kernel reaches `RUNNING`, `ctx.resolve` returns `null`. See [Boot and lifecycle](../03-concepts/boot-and-lifecycle.md).

The tested code is in [`shout.mjs`](../examples/shout.mjs) and [`shout.test.mjs`](../examples/shout.test.mjs).

## Next steps

- [Gate access with capabilities](gate-access-with-capabilities.md)
- [Handle errors](handle-errors.md)
