# Intercept calls

Log, change or block calls to another participant's exposure, such as `acme.greet`.

## Before you begin

Read [Interception](../03-concepts/interception.md). Interception needs two participants: a giver and an interceptor.

## Steps

1. **Open an interception point on the giver.** List the interceptors it admits. The order is the run order.

   ```js
   interceptionPoints: [{ exposure: 'acme.greet', version: 1, admit: [AuditorToken] }]
   ```

2. **Call the evaluator in the giver's projection**, before running the real method. Without this call, nothing is intercepted.

3. **Declare the interception on the interceptor.**

   ```js
   interceptions: [{ target: 'acme.greet', version: 1 }]
   ```

4. **Implement `intercept(call)`** on the interceptor's instance. Return one of:

   - `{ verdict: 'allow' }`
   - `{ verdict: 'block', reason }`
   - `{ verdict: 'modify', args }`

## Behavior to know

- The first `block` wins.
- A thrown error counts as a block.
- `modify` changes arguments only, and the new arguments must be plain JSON.

> **Important**
> Interception is cooperative. A giver that opens no point cannot be intercepted.

## Next steps

- [Handle errors](handle-errors.md)
