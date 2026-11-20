# Exposures, scope and policy

An **exposure** is an API a giver offers. This page explains how the giver controls who gets it.

## The shape of an exposure

An exposure has a **name**, a major **version**, a **scope**, an optional **policy**, and a **projection** (the handle callers receive).

```js
exposes: {
  'acme.greet': {
    version: 1,          // major version, default 1
    scope: 'any',        // who may even try
    policy: undefined,   // optional extra rules
    handle: (caller, ctx) => ({ /* what this caller gets, or null */ }),
  },
}
```

With the SDK the default scope is `runtime`. Choose deliberately.

## Three gates

A call passes three gates, in order.

1. **Scope.** Is the call chain's *origin* allowed at all?
2. **Policy.** Does the caller satisfy the giver's declared rules?
3. **Projection.** Your `handle` runs with the real caller's view. It may return `null` to refuse, or a handle shaped for that caller.

A refusal at any gate makes `resolve` return `null`.

> **Note**
> The caller cannot tell which gate refused. This is deliberate: it stops callers from probing what exists.

## Scope

Scope is about where the chain began. It is checked against the **root origin** of the chain, not the immediate caller.

| Scope | Admits origins |
|---|---|
| `kernel` | `kernel` only |
| `runtime` | `kernel` and `runtime` |
| `host` | `host` only |
| `any` | all |

A scope can be widened inside a major version, and the widening is recorded. It can never be narrowed inside a major version. To narrow, publish a new major version. Changing between `runtime` and `host` counts as narrowing, because each admits callers the other does not.

## Policy

Policy narrows further, inside whatever the scope allows. It is a small, versioned, data-only language: no code runs to evaluate it, and unknown fields refuse the declaration.

```js
policy: {
  policyVersion: 2,
  origins: ['host'],
  callerClasses: ['participant'],
  parentCallerClasses: ['participant'],
  capabilities: ['vault:read'],
  official: true,
}
```

| Field | The caller must... |
|---|---|
| `policyVersion` | Be `2`. Any other version is refused, fail closed |
| `origins` | Come from one of these root origins |
| `callerClasses` | Belong to one of these classes (`kernel`, `participant`, `host`) |
| `parentCallerClasses` | Have a parent whose class is in this list (a top-level caller fails this) |
| `capabilities` | Have declared **every** capability listed |
| `official` | Have exactly this official status in the composition |

Every field is optional. Leave out what you do not need.

## Projections: tailor the handle

The policy is a coarse filter. The projection is where you give each caller exactly what it should have. `byCapability` from the SDK is the common case:

```js
handle: byCapability({
  'vault:read':  (ctx) => ({ read: () => ctx.instance.secret }),
  'vault:write': (ctx) => ({ write: (v) => { ctx.instance.secret = v; } }),
})
```

A caller with only `vault:read` gets `{ read }`. One with both gets both. One with neither gets `null`. See [Gate access with capabilities](../04-guides/gate-access-with-capabilities.md).

## Re-authorization

Resolving does not end the checking. **Every call through a handle is authorized again** against the chain making it. A handle held past the end of its chain is refused with `EXPOSED_API_UNAVAILABLE`.

> **Important**
> Resolve and use a handle inside the same call. Do not store it for later.

## Names and versions

- Names are dotted and lower-case (`acme.greet`). A name belongs to the first participant that registers it.
- A composition can **pin** an exposure name to a specific owner identity with `exposureOwners` in the config. Then only that identity may register it.
- Callers can ask for a version and an expected owner: `registry.resolve(name, { version, expectedOwner })`.

**Next:** [Compositions and config](compositions-and-config.md)
