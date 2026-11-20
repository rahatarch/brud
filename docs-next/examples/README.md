# Runnable examples

Every code sample in the tutorials lives here, so you can run it instead of retyping it.

| File | What it shows | Used in |
|---|---|---|
| `greeter.mjs` | A participant that gives one API, written with `defineParticipant` | [Your first participant](../02-getting-started/your-first-participant.md) |
| `boot-greeter.mjs` | Boot a kernel from a composition and call the greeter as a host | [Boot a kernel](../02-getting-started/boot-a-kernel-and-call-it.md) |
| `notes.mjs` | A participant that owns the operation kind `note` | [Own a kind](../04-guides/own-a-kind.md) |
| `route-notes.mjs` | Send Brud syntax text to the kernel and read the results | [Own a kind and route text](../02-getting-started/own-a-kind-and-route-text.md) |
| `vault.mjs`, `vault.test.mjs` | Shape an API by the caller's capabilities, and test it | [Gate access](../04-guides/gate-access-with-capabilities.md) |
| `shout.mjs`, `shout.test.mjs` | One participant using another's API | [Use another participant](../04-guides/use-another-participants-api.md) |
| `daemon-demo.mjs` | Start a daemon, connect a client, boot a kernel and route text | [Connect a client](../05-daemon/connect-a-client.md) |

## Running them

The samples import `@brud/kernel`, `@brud/sdk` and `@brud/daemon`. Run them from a project that has those packages installed, or from this repository's root (where the workspace links them).

```bash
node docs-next/examples/boot-greeter.mjs
node docs-next/examples/route-notes.mjs
node --test docs-next/examples/vault.test.mjs docs-next/examples/shout.test.mjs
node docs-next/examples/daemon-demo.mjs
```

Requires Node.js 22 or newer. The packages must be built (`dist/` present).

Each script uses a temporary folder for its state and removes nothing outside it.
