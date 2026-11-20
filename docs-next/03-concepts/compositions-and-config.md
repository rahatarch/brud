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

- **Hardcore** is decided by the BrudOS release. The seven hardcore services are compiled into the kernel and pinned by content hash. Every composition gets the same set. You cannot remove, replace or re-pin one, and the kernel will not boot without them.
- **Official** is decided by *you*, the owner of the composition, in your own config. It says "I trust this participant in my system."

> **Important**
> A package never gets to call itself official. No naming convention, scope or manifest field confers it. The `@brud` npm scope tells you who wrote a package. It does not make the package official in your system.

## What official changes

The kernel builds an identity-to-official mapping from your config at boot. Giver policies can then require `official: true`.

In this beta, a module that is not declared official is refused as native code. Code you have not declared official is meant to run only inside the [WASM cage](the-wasm-cage.md), as a [participant package](the-wasm-cage.md#how-a-participant-reaches-the-cage). A plain JavaScript module that is not official is refused with `PARTICIPANT_TIER`.

## Trust is a content hash

Hardcore pins are compiled into the kernel. For your own official participants, pinning is your decision in your config. There is no publisher signature and no marketplace in the trust chain: the act of pinning is the trust decision.

## Frozen at boot

The config is frozen once the kernel boots. A change to it while the kernel is running is refused, and the root config file is protected from deletion. A change between boots is a new trust decision.

## Errors you may see while loading

| Code | Meaning |
|---|---|
| `CONFIG_READ` | The file could not be read |
| `CONFIG_PARSE` | The file is not valid JSON |
| `CONFIG_SCHEMA` | The shape is wrong (unknown key, missing `services`) |
| `CONFIG_INTEGRITY` | A protected config or state path was touched |
| `MODULE_RESOLVE` | A module could not be found or imported, or a participant package failed its digest check |
| `MODULE_CONTRACT` | A module does not export a valid `createService` |
| `PARTICIPANT_TIER` | A participant claims a tier it may not have, or a plain module is not declared official |
| `HARDCORE_VERIFICATION` | A hardcore service failed its content-hash check |

**Next:** [Boot and lifecycle](boot-and-lifecycle.md)
