# Compositions and config

A **composition** is one kernel, one config, one owner, one boot. Everything in BrudOS is relative to a composition: BrudOS itself is one composition, and every system you build is another.

The terms *official*, *hardcore*, *trust* and *root* all mean something only inside a composition.

## The config file

The config is a JSON file, conventionally `brud.config.json`.

```json
{
  "services": [
    { "path": "kernel:serviceModules/identityRegistry.js", "official": true },
    { "path": "kernel:serviceModules/exposedApiRegistry.js", "official": true },
    { "path": "kernel:serviceModules/parser.js", "official": true },
    { "path": "kernel:serviceModules/router.js", "official": true },
    { "path": "kernel:serviceModules/wasmCage.js", "official": true },
    { "path": "kernel:serviceModules/events.js", "official": true },
    { "path": "kernel:serviceModules/interception.js", "official": true },
    { "path": "/abs/path/to/my-participant.mjs", "official": true }
  ],
  "exposureOwners": {}
}
```

| Key | Meaning |
|---|---|
| `services` | Ordered list of participants to load |
| `services[].path` | An absolute path, a package name, a relative path, or a `kernel:` module |
| `services[].official` | The owner's declaration that this participant is official |
| `exposureOwners` | Optional map from an exposure name to the only identity allowed to register it |

Entries accept only `path` and `official`. Other top-level sections belong to the participants that own them and are carried along untouched.

## Hardcore versus official

These are independent, and the difference is important.

- **Hardcore** is decided by the BrudOS release. The seven hardcore services are compiled into the kernel and pinned by content hash. Every composition gets the same set. You cannot remove, replace or re-pin one, and the kernel will not boot without them. Every hardcore entry must also be declared `"official": true`. If one is `false` or has no `official` key, the boot is refused with `PARTICIPANT_TIER` before anything starts. A hardcore cannot run caged or unofficial.
- **Official** is decided by *you*, the owner of the composition, in your own config. It says "I trust this participant in my system."

> **Important**
> A package never gets to call itself official. No naming convention, scope or manifest field confers it. The `@brud` npm scope tells you who wrote a package. It does not make the package official in your system.

## What official changes

The kernel builds an identity-to-official mapping from your config at boot. Giver policies can then require `official: true`.

In this beta, a module that is not declared official is refused as native code. Code you have not declared official is meant to run only inside the [WASM cage](the-wasm-cage.md), as a [participant package](the-wasm-cage.md#how-a-participant-reaches-the-cage). A plain JavaScript module that is not official is refused with `PARTICIPANT_TIER`. A package that cannot run caged (a filesystem service, for example) can declare `requires: { official: true }`; leaving such an entry unofficial is refused with `PARTICIPANT_REQUIRES_OFFICIAL`, and the owner decides whether to declare it official or remove it.

## Trust is a content hash

Hardcore pins are compiled into the kernel. For your own official participants, pinning is your decision in your config. There is no publisher signature and no marketplace in the trust chain: the act of pinning is the trust decision.

## Frozen at boot

The config is frozen once the kernel boots. A change to it while the kernel is running is refused, and the root config file is protected from deletion. A change between boots is a new trust decision.

Two consequences follow for a host application:

- It cannot edit its own root config while the kernel runs. A write fails with `CONFIG_INTEGRITY`.
- The kernel remembers the config's content for the life of the process. If the file changes and the same process boots that path again, the boot is refused with `CONFIG_INTEGRITY`, even after the first kernel has shut down. To apply a changed composition, call `reload` on the kernel the host holds (see below), or restart the process.

## Reloading a composition

`bootKernel` returns a kernel with a `reload` method. Only the host holds that kernel; no participant ever receives it.

```js
const next = await kernel.reload({ configPath: './brud.config.next.json' });
```

`reload` checks the new config, composes it, stops the current kernel and boots the new one with the same options. It returns the new running kernel, and the old one is disposed. `configPath` defaults to the path the kernel booted from, so a host can edit its config file while no kernel runs it, then reload.

What a reload may change is every participant that is not official: which exist, their packages and their options. What it may not change is what the build froze: the official participants, in order, and the exposure owners. A config that changes those is refused with `CONFIG_RELOAD_FROZEN`; rebuild to change them. The hardcore services are re-verified against their compiled-in pins on every boot, reload included.

A reload refused before the old kernel stops, because the config is invalid or touches the frozen part, changes nothing. If the new composition passes those checks but then fails to boot, the old kernel is already stopped: `reload` throws `KERNEL_RELOAD_FAILED` with the cause and the host has no running kernel. The kernel does not restart the old composition. Handles that participants resolved before the reload stop working, and the new participants get new identities. Shutdown does not wait for calls in flight.

## Errors you may see while loading

| Code | Meaning |
|---|---|
| `CONFIG_READ` | The file could not be read |
| `CONFIG_PARSE` | The file is not valid JSON |
| `CONFIG_SCHEMA` | The shape is wrong (unknown key, missing `services`) |
| `CONFIG_INTEGRITY` | A protected config or state path was touched |
| `CONFIG_RELOAD_FROZEN` | A reload tried to change an official participant or an exposure owner |
| `KERNEL_RELOAD_FAILED` | The new composition failed to boot after the old kernel was stopped |
| `MODULE_RESOLVE` | A module could not be found or imported, or a participant package failed its digest check |
| `MODULE_CONTRACT` | A module does not export a valid `createService` |
| `PARTICIPANT_TIER` | A participant claims a tier it may not have, or a plain module is not declared official |
| `HARDCORE_VERIFICATION` | A hardcore service failed its content-hash check |

**Next:** [Boot and lifecycle](boot-and-lifecycle.md)
