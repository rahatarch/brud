# Interception

Interception lets one participant inspect, change or block calls to another participant's exposure, and append to its result. The giver decides whether that is possible at all.

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

## The output stage: appending to a result

An interceptor can also add content to what the giver returns, and nothing else. It cannot change, replace, remove or withhold the result.

```js
// interceptor manifest: take part in the output stage (the default is ['input'])
interceptions: [{ target: 'acme.greet', version: 1, stages: ['output'] }]
// interceptor instance
interceptResult(call) { return { verdict: 'append', content: { note: 'reviewed' } }; } // or { verdict: 'none' }
```

- `stages` lists `'input'`, `'output'` or both. An interceptor takes part only in the stages it declares, and must implement each one (`intercept`, `interceptResult`), or the call fails closed.
- `call` has `target`, `method`, `args` (as finally passed), the real caller, and `result`: the giver's result as a deep-frozen copy. Each interceptor sees only the original result, never another's addition.
- The verdict is `{ verdict: 'none' }` or `{ verdict: 'append', content }`, where `content` is plain JSON. Anything else, a throw, a missing method, or a limit breach withholds the result (fail closed).
- Interceptors run in the giver's `admit` order. The result the caller receives is an envelope: `{ result, additions: [{ interceptor, content }], interceptedBy }`, with `result` exactly as the giver returned it, the additions in run order, and every interceptor that ran. When no admitted interceptor declares the output stage, the giver returns its result as before.
- The result must be plain JSON to take part, and is limited, with kernel ceilings of 1 MiB for the result, 64 KiB for one addition and 256 KiB for all additions. The giver may lower any of them with `outputLimits` on the point (`maxResultBytes`, `maxAdditionBytes`, `maxTotalBytes`) and can never raise one. A value above a ceiling refuses the boot.
- Every step is recorded on the kernel's observation stream (`interception.result.appended`, `.unchanged`, `.failed`, `.refused`), never with the content.

```ts
const staged = evaluate.evaluateResult('acme.greet@1', 'greet', args, result, { caller });
if (!staged.applied) return result;
if (!staged.allowed) throw new InterceptionBlockedError('acme.greet@1', staged.reason, staged.interceptor);
return staged.envelope;
```

A caged interceptor that declares the output stage exports `brud_intercept_result`, answering with the same two verdicts as JSON. A caged giver gets the output stage applied for it.

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
