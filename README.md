# Brud OS

An autonomous agent is only useful if it can take action. Letting it act safely is the hard part.

**Brud OS is a foundation for building autonomous agents: software that takes actions on your behalf inside a project folder you control.**

## What Brud OS is: the kernel

Brud OS is built around a kernel. **In Brud, the kernel is a service orchestrator.**

Services are the core capabilities the kernel manages, such as a file system or a terminal. Plugins are packages that register tools for an agent and declare which capabilities they need — in other words, which operations they are allowed to perform.

The kernel manages those services, decides what each service is allowed to do, and passes requests between the services and the agent or application asking. **It has no built-in capabilities.** It does not open files, run commands, or remember history. Everything an agent can do is added as a service or a plugin.

A workspace is the project folder Brud is allowed to operate in. Add a capability by adding a service or a plugin; **the kernel itself does not change.**

When Brud starts, the kernel reads the dependencies between services, starts them in the right order, and checks every request to confirm the caller is allowed to use the service it is asking for.

## The Starter Pack model

Brud ships with ready-made bundles of services and plugins called **Starter Packs**.

Each Starter Pack turns the bare kernel into a complete environment for a specific kind of agent: a coding agent, a video agent, or a compliance agent. The kernel does not change between packs; only the services and plugins do. Today, this repository ships the Coding Starter Pack.

## The Coding Starter Pack

The Coding Starter Pack gives a coding agent what it needs to work in a project. **It registers the services a coding agent needs.**

A file system service lets the agent read and change files, but only inside the project; it refuses paths outside it. A terminal service runs commands and screens them against a policy before they execute.

A history service records every change with before-and-after states and can undo a whole session. Settings, validation, and workspace services store configuration, check requests and commands before they run, and keep paths consistent.

A plugin manager loads plugins and limits each plugin to the capabilities it declared. A tool service exposes the actions available to the agent; an action service handles operations that only a user interface can call; a utility service provides shared helpers such as working out which files a source file imports.

**The pack also ships the plugins that give the agent its tools.** Reader, search, and structure plugins read files, find text, and extract a compact map of the project. Catalog lists the tools available to the agent. Filesystem creates, moves, and deletes files. Terminal runs commands.

The MCP bridge connects the agent to external tools through the Model Context Protocol, a standard way for AI tools to call other tools. The user prompts plugin stores reusable prompts.

- **Contained.** The file system service only lets the agent touch files inside the project.
- **Journaled.** Every change through the file system service is recorded with before-and-after states.
- **Reversible.** A session can be undone.

These are properties of the Coding Starter Pack, not of the kernel. The kernel manages and connects the services; **the pack supplies the guarantees.**

## The pattern for other domains

A Photoshop Starter Pack would bring services for image editing, and a compliance Starter Pack would bring services for audits. **The kernel stays the same.**

## Honest boundaries

### Kernel design

Plugins run inside the same process as the kernel. They are restricted to the capabilities they declare, but **the kernel does not contain hostile code.** This is how the kernel is built.

### Coding Starter Pack scope

The shipped pack does not provide an operating-system sandbox.

The terminal service screens commands against a policy, but a command that passes can write outside the workspace. Those writes are outside the history record.

History reversal covers changes made through the pack's file system service only. Unrecorded paths cannot be reverted, and directory reversal has documented limits.

### Project status

Brud OS is a developer preview. The Coding Starter Pack is the only pack that ships today.

There is no marketplace and no system for distributing third-party Starter Packs. Public interfaces may change before the first stable version.

The way to build a real product on Brud today is to fork the repository. Everything described in this document ships in the repository: the kernel, the Coding Starter Pack, and the pattern for additional Starter Packs. Fork it, register the services and plugins your domain needs, and ship your product. A published, stable Brud package is a future state, not today's.

## Where to go next

**To work with the code,** clone the repository and install dependencies with `npm install`.

- [ARCHITECTURE.md](ARCHITECTURE.md) — how the repository and engine are structured.
- [Kernel architecture standard](docs/architecture/ENGINE_ARCHITECTURE_STANDARD.md) — the kernel's rules and service boundaries.
- [History engine specification](docs/architecture/BRUD_HISTORY_ENGINE_SPEC.md) — how changes are recorded and reversed.
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to contribute.

A dedicated Starter Pack guide is in progress; in the meantime, the architecture documents above cover the same ground.

## License

Brud OS is released under the [**MIT License**](LICENSE).

Brud OS is developed by Akkhar-Labs.