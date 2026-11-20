# Cheat sheet

## Define a participant

```js
defineParticipant({
  id: 'acme.greeter',
  exposes: { 'acme.greet': { version: 1, scope: 'any', handle: (caller, ctx) => ({ /* ... */ }) } },
})
```

## Scopes

| Scope | Admits origins |
|---|---|
| `kernel` | kernel |
| `runtime` | kernel, runtime |
| `host` | host |
| `any` | all |

## Policy v2 fields

`policyVersion: 2`, `origins`, `callerClasses`, `parentCallerClasses`, `capabilities`, `official`.

## Manifest keys

`requests`, `exposures`, `events`, `interceptions`, `interceptionPoints`, `kinds`.

## Boot and call

```js
const kernel = await bootKernel(configPath, { options });
await kernel.runHostCall({ capabilities: [] }, async () => { /* resolve and use handles */ });
await kernel.shutdown();
```

## Rules to remember

1. `resolve` returning `null` means "not for you" or "does not exist".
2. Use handles inside the call that resolved them.
3. Only you, the owner, mark things `official`.
4. One owner per kind and per exposure name.
5. Branch on `error.code`, never on messages.
6. Startup options live in your own namespace.

## Brud syntax

```text
[BRUD]
[CALL kind name]
key: value
[END]
[/BRUD]
```

More: [Glossary](glossary.md) · [Error codes](error-codes.md) · [Troubleshooting](troubleshooting.md)
