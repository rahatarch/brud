# Architecture at a glance

This page is the map. Details are in [Concepts](../03-concepts/README.md).

## The layers

| Layer | What it is | Who writes it |
|---|---|---|
| **Host** | The program that boots and talks to a kernel: your app, a test, or the daemon | You |
| **Kernel** | The engine: call chain, access broker, lifecycle, config loader | BrudOS |
| **Hardcores** | Seven built-in services the kernel will not boot without | BrudOS |
| **Participants** | Everything else: services, tools, plugins | You and others |

The hardcores are Level-1 services that ship with the kernel. They are called *hardcore* because they are compiled in and pinned: you cannot remove or replace them. They are not part of the kernel's engine code.

## The seven hardcores

They boot in this order.

| # | Hardcore | Job |
|---|---|---|
| 1 | **Identity Registry** | Issues, records and revokes each participant's kernel identity |
| 2 | **Exposed API Registry** | Holds every exposure and answers `resolve`, applying the giver's scope and policy |
| 3 | **Parser** | Turns Brud syntax text into operation records |
| 4 | **Router** | Sends each operation to the participant that owns its kind |
| 5 | **WASM Cage** | The isolation primitive for code that is not official |
| 6 | **Events** | Pull-based events with sequences and retention |
| 7 | **Interception** | Lets a participant observe or change calls to a giver that allows it |

## What happens when a kernel boots

1. **Read the config.** The kernel loads your composition file and checks its shape.
2. **Verify and start the hardcores.** Each is checked against a content hash compiled into the kernel. If one is missing or wrong, boot stops.
3. **Admit participants.** Each manifest is validated. A required startup field that the host did not supply refuses the boot, for every participant; the error names the field and the participant.
4. **Initialize.** Participants are constructed and initialized in dependency order. If any of them fails, everything that already started is rolled back and boot fails.
5. **Running.** The kernel enters `RUNNING`. Configuration is frozen. Participants' `onRunning` hooks fire and `resolve` becomes live.

Lifecycle states are `UNINITIALIZED`, `BOOTING`, `RUNNING`, `SHUTTING_DOWN` and `DISPOSED`.

## How a call travels

Suppose a client sends the text `[CALL note add]` to a running kernel.

```text
client -> host call (origin: host, with the host's capabilities)
       -> Parser reads the text into operations
       -> Router finds the owner of the kind "note"
       -> kernel resolves the owner's dispatch exposure, checks scope and policy
       -> the owner's dispatch(operation, context) runs, as the owner
       -> result is collected, one outcome per operation
```

Two details matter:

- The **real caller** (identity, class, capabilities, origin) travels with the call. The owner reads it from `context.caller`. The client cannot forge it.
- The owner's code **runs as the owner**. When it calls somebody else, the kernel sees the owner as the caller.

## The packages

| Package | What it gives you |
|---|---|
| [`@brud/kernel`](package-overview.md#brudkernel) | The kernel, `bootKernel`, contracts, hardcore services |
| [`@brud/sdk`](package-overview.md#brudsdk) | `defineParticipant`, `byCapability`, and a test harness |
| [`@brud/daemon`](package-overview.md#bruddaemon) | A local host that boots kernels for clients, plus `connectToDaemon` |
| [`@brud/protocol`](package-overview.md#brudprotocol) | The daemon's wire types, method names and error codes |

**Next:** [Package overview](package-overview.md), then [Install](../02-getting-started/install.md).
