# The manifest

The manifest is the declarative part of a participant: plain data, validated when the participant is admitted and frozen afterwards. It says what the participant offers and wants. It never grants anything.

## Keys

The manifest accepts exactly these top-level keys. Any other key refuses the boot with `PARTICIPANT_MANIFEST_INVALID`.

| Key | What it declares |
|---|---|
| `requests` | What this participant asks for. Today: `{ capabilities: [...] }` |
| `exposures` | The APIs it gives: `name`, `version`, `scope`, `policy` |
| `events` | Events it can emit: `name`, `version`, `scope`, `policy`, `payloadSchema` |
| `interceptions` | Giver calls it wants to intercept: `target`, `version` |
| `interceptionPoints` | Its own exposures it lets others intercept: `exposure`, `version`, `admit` |
| `kinds` | Operation kinds it owns: `kind`, `exposure`, `version`, `description`, `operations` |

Inside `kinds[].operations`, each operation has `description` and `input`. The exact accepted keys per section are generated into [`docs/kernel-api/catalogue/manifest.md`](../../docs/kernel-api/catalogue/manifest.md).

## Example

```js
manifest: {
  requests: { capabilities: ['vault:read'] },
  exposures: [
    { name: 'acme.notes', version: 1, scope: 'any' },
    { name: 'acme.notes.dispatch', version: 1, scope: 'any', policy: { policyVersion: 2, official: true } },
  ],
  kinds: [{ kind: 'note', exposure: 'acme.notes.dispatch', description: 'Keep short notes' }],
},
```

## Rules the kernel enforces on a manifest

- It must be plain JSON data with only the known keys.
- Exposure names and versions must be valid, and a name belongs to its first registrant (`EXPOSED_API_NAME_COLLISION` otherwise).
- A kind has exactly one owner per composition (`ROUTER_KIND_COLLISION`).
- A kind's `exposure` must be one of the participant's own exposures.
- An event name belongs to its first declarer (`EVENTS_NAME_COLLISION`).

## With `defineParticipant`

`defineParticipant` writes the `requests` and `exposures` sections for you from its `requests` and `exposes` fields, and binds each exposure to its `handle`. For `kinds`, `events` and the interception keys, write the descriptor by hand. See [Own a kind](../04-guides/own-a-kind.md).

**Next:** [Identity and the call chain](identity-and-call-chain.md)
