# Interception

Interception lets one participant inspect, change or block calls to another participant's exposure. The giver decides whether that is possible at all.

## Two roles

- **The giver** opens an interception point on one of its own exposures and lists, in order, which interceptors it admits.
- **The interceptor** declares what it wants to intercept and implements `intercept(call)`.

```js
// giver manifest
interceptionPoints: [{ exposure: 'acme.greet', version: 1, admit: [AuditorToken] }]
// interceptor manifest
interceptions: [{ target: 'acme.greet', version: 1 }]
// interceptor instance
intercept(call) { return { verdict: 'allow' }; }
```

Verdicts: `{ verdict: 'allow' }`, `{ verdict: 'block', reason }`, `{ verdict: 'modify', args }`.

## Semantics

- Interceptors run in the giver's `admit` order, each as itself.
- Each sees a frozen call with `target`, `method`, `args` and the real caller.
- The first `block` wins. `modify` replaces arguments only (re-validated as plain JSON) and chains.
- A throw or an invalid verdict blocks. It fails closed.
- Interceptors are never registered with the registry and cannot be resolved.

## The giver opts in

The giver's projection must call the evaluator. A giver that opens no point cannot be intercepted. Interception is cooperative.

```ts
const outcome = evaluate.evaluate('acme.greet@1', 'greet', args, { caller });
if (!outcome.allowed) throw new InterceptionBlockedError('acme.greet@1', outcome.reason, outcome.interceptor);
```

`evaluate` comes from `registry.resolve('interception.evaluate')`. Only the point's owner may use it.

## Boot refusals

The kernel refuses to boot with `INTERCEPTION_DECLARATION_INVALID` in these cases:

- An interception that no giver admits.
- An admitted participant that did not declare the interception.
- A point on an exposure the declarer does not give.
- An attempt to intercept a hardcore's exposure.

**Next:** [The WASM cage](the-wasm-cage.md)
