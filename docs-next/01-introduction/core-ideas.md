# Core ideas

Eight ideas explain almost everything in BrudOS. Read them once before the rest of the docs. Each has a longer page in [Concepts](../03-concepts/README.md).

## 1. Everything is a participant

A service, a tool, a plugin, an app piece: they are all participants. The kernel treats them the same way, whoever wrote them.

## 2. A manifest is a request, not a grant

A participant describes what it wants in a **manifest**: the APIs it gives, the capabilities it asks for, the operation kinds it owns. The manifest is validated and then frozen. It never gives the participant any power by itself.

## 3. The giver decides

The participant that offers an API is the **giver**. When someone wants to use it, the giver's rules decide. The kernel's job is to ask the giver and enforce the answer. It does not decide on the giver's behalf.

## 4. Identity is not authority

At boot the kernel issues every participant a **kernel identity**. It proves who is calling. It does not prove what they may do. Authority always comes from the giver's policy.

## 5. Every call has a call chain

Each call runs inside a **call chain** the kernel tracks. The chain records the real caller: their identity, class, capabilities, whether they are official, and where the chain started (`kernel`, `runtime` or `host`). A caller cannot change these.

## 6. Exposures are resolved, then called

To use an API you **resolve** it by name: `registry.resolve('acme.greet')`. You get back a handle shaped for you, or `null` if the giver refused. Every later use of the handle is checked again.

## 7. Official is the composition owner's choice

Whether a participant is **official** is declared by the owner of the composition in its own config. A package never gets to say it is official. In this beta, a module that is not declared official is refused as native code; unofficial code is meant to run inside the WASM cage.

## 8. The kernel boots as one sequence

Seven built-in services, the **hardcores**, start first and are checked against pinned content hashes. Then your participants start. If anything fails, everything rolls back. The configuration is frozen once the kernel is running.

## How they fit together

```text
  host (your program, or the daemon)
      |  runs a host call, resolves exposures
      v
  +-------------------- kernel ---------------------+
  |  call chain  -  identity  -  exposed API registry |
  |  hardcores: identity, registry, parser, router,   |
  |             wasm cage, events, interception       |
  +---------------------------------------------------+
      |  every call is routed to the giver
      v
  participants: your services, tools, plugins
```

**Next:** [Architecture at a glance](architecture-at-a-glance.md)
