# What is BrudOS?

BrudOS is a small kernel you embed in a program to build software out of independent pieces. Each piece is a **participant**. The kernel makes sure the pieces can work together without trusting each other.

If you have used a plugin system, a microservice architecture, or an operating system, parts of this will feel familiar. The difference is the contract: the kernel does almost nothing by itself, and it is strict about who may do what.

## The problem it solves

Software built from many parts has a trust problem. A plugin can read what it should not. A service can pretend to be another service. One part can quietly import another part's internals and break when those change. And when an AI agent is one of the callers, you also need to know exactly what it was allowed to do and who it was acting as.

BrudOS solves this at the foundation instead of in every project:

- Every participant gets an **identity** from the kernel. Nobody can claim someone else's.
- Every API is **owned**. The owner decides who may call it. The kernel enforces the owner's answer.
- Nothing is shared by importing. Participants reach each other through declared APIs only.
- Code you have not declared official does not run as ordinary native code in your process.

## What the kernel does (and does not)

The kernel has **zero capabilities of its own**. It does not read files, call the network or run commands. It routes calls, enforces rules and holds invariants. Everything useful is a participant.

That keeps the kernel small enough to understand completely, and it means the same kernel can host a code editor backend, a chat agent runtime, or something nobody has built yet.

## What you build with it

You write participants. A participant can:

- **Give** an API for others to call (an *exposure*).
- **Own an operation kind** so clients can send it text commands like `[CALL note add]`.
- **Emit events** other participants can subscribe to.
- **Intercept** calls to another participant's API when that participant allows it.
- **Call** other participants' APIs, as itself.

You then list the participants you want in a **composition**, a small JSON file, and boot the kernel from it.

## Two ways to run it

1. **Embedded.** Your program imports `@brud/kernel`, boots a kernel and talks to it directly. This is what the [getting started](../02-getting-started/README.md) tutorials do.
2. **Behind the daemon.** `@brud/daemon` is a background process that boots kernels on request and serves them to local clients over an authenticated channel. UIs and AI agents connect to it. See [the daemon](../05-daemon/README.md).

## What is not in this documentation

The "composed services" (filesystem, workspace, terminal, history and so on) are built on top of BrudOS and published as separate packages. The core never depends on them. Their docs ship with them.

**Next:** [Core ideas](core-ideas.md)
