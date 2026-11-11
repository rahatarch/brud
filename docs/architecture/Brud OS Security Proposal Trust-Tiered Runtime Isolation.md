# Brud OS Security Proposal: Trust-Tiered Runtime Isolation

Nov 11, 2026 · @Rahat Hasan

## Summary

Only code the product owner declares official in `brud.config.json` should run with full Node.js access; everything else should run in a WebAssembly (WASM) cage with only the capabilities the kernel grants it.

This closes the biggest gap in the current Honest Boundaries: the kernel cannot contain hostile code. It does so without breaking Brud's core rule that the kernel knows only the concept of services. The kernel never learns what a plugin or extension is; it only learns **who is trusted**, and every new concept automatically inherits the cage.

Most of the pieces already exist: the Brand Registry, the frozen official registry, config-driven boot, kernel purity, and the Exposed API Registry. This proposal adds a cage at the door rather than a rewrite of the core.

## The problem

The kernel can only see and check calls that go through its own APIs, and in-process code does not have to use them.

- **Plugins and services share one Node.js process with the kernel.** A plugin can call `require('fs')` or `require('child_process')` directly, delete files or run commands, and the kernel never hears about it.
- **Capability checks only bind honest code.** "Limited to declared capabilities" holds while a plugin chooses to call kernel APIs. A hostile plugin simply walks around them.
- **In-process code can also tamper with the kernel.** It shares memory with kernel internals and other services, so it may patch objects, read secrets or interfere with identity.
- **History and undo are incomplete.** Changes made through Node directly never reach the history service, so they cannot be reverted.
- **Out-of-process alone does not fix it.** A separate process cannot touch kernel memory, but without a sandbox it still has the user's full OS permissions and can bypass the kernel the same way.

The root cause is that Brud's kernel is a kernel in architecture but not in privilege. An OS kernel sees everything because the CPU forces programs through system calls; Brud has no such hardware enforcement, so tracking must come from confinement.

## Design principles

Five rules shape the design, and each fits the architecture Brud already has.

1. **Trust attaches to identity, not concept type.** A service, plugin, extension or any future concept can be declared official. The runtime is chosen by trust alone.
2. **The official flag is compile-time only.** It is decided in `brud.config.json`, frozen at boot and never granted at runtime. Runtime only *verifies* that loaded code matches what was frozen.
3. **Deny by default (no ambient authority).** Non-official code starts with zero powers. It can only use capabilities the kernel explicitly hands it.
4. **One door for code.** Loading new code is itself a capability, held by exactly one declared loader. No second loader can appear at runtime.
5. **The kernel stays concept-agnostic.** The kernel never learns what a plugin or extension is. Brand and trust decisions are data from the config, not hardcoded knowledge.

## Trust tiers

Every piece of code lands in one of three tiers, chosen by its brand at load time.

| Tier | Who decides | Runtime | Access |
| --- | --- | --- | --- |
| Official | Product owner, in `brud.config.json` | Node.js daemon, in-process | Full Node and OS access (root-equivalent) |
| Non-official (default) | Automatic for any third-party brand | WASM; SES compartments as the option for JS/TS authors | Only kernel-granted capabilities |
| Non-official, needs native power | Product owner | Separate process with an OS sandbox, or promoted to official after review | Only kernel-granted capabilities, plus what the sandbox permits |

The Brand Registry already distinguishes official from third-party brands, so it becomes the switch that picks the cage. Third-party scopes stay supported: an owner can review a vendor and promote it to official in their own config. Brud does not judge that choice; it enforces it.

Because official means root-equivalent access, Brud should make that list visible rather than limit it: ship a minimal default config, print the official list at boot, and warn in dev mode about unexpected sources.

## Protecting the official flag

The official flag is the most sacred access in Brud, so the kernel must prove that code claiming it is genuine: names can lie, hashes and signatures cannot.

- **Fingerprint, not name.** Each official entry in the config pins a package, a version and an integrity hash. The kernel hashes the code before loading it; a mismatch refuses boot.
- **Publisher signatures (optional).** The config can pin a publisher's public key, so new versions are accepted only when signed by that publisher.
- **Verify at every load.** The official list is frozen at boot, but plugins and extensions may load at runtime. Each runtime load checks the code against the frozen hash; a mismatch is treated as an imposter and refused or caged.
- **Only the kernel issues official brands.** Brands come from the frozen list at boot. A runtime claim of being official is ignored.
- **Exact-path loading.** Official code loads from verified locations, not through normal module resolution that `node_modules` shadowing or dependency confusion could hijack.
- **Dependency hygiene.** An official service's dependencies also run with full privileges. Pin them with a lockfile, install with lifecycle scripts disabled where possible, and keep official dependency trees small.
- **Protect the config.** The agent, plugins and the file system service must never be able to write `brud.config.json`, or an attacker could simply add an imposter.
- **Explicit update approval.** A new version means a new hash, which the product owner must approve.
- **Boot trust report.** Print every official component with its version and hash at startup, so owners see exactly what holds full trust.

## The WASM host model

Inside WASM, Node's APIs do not exist, so nothing has to be blocked: a caged plugin can only call functions the kernel imports into it.

&#91;embedded content: trust tiers · caged code calls the kernel through imports\]

Third-party code in WASM can only call kernel imports; the kernel checks and journals each call before official Node services touch the OS.

WASM is a virtual instruction set, much like Nirdeshika-16. A program on it can compute, but it has no instruction for opening a file or a socket. Any contact with the outside world goes through imports the host provides, just as Nirdeshika's only way out is the `প্রদর্শন` instruction.

- **Capabilities become imports.** The kernel exposes what a plugin may do as imported functions, either one per capability or a single routed door such as `kernel.call(service, method, args)`.
- **The registry becomes the routing table.** The generic door routes through the Exposed API Registry, so newly registered services are reachable without new imports, and the kernel checks capabilities on every call.
- **Plugins export, the kernel calls.** Tools, actions and event handlers are exported functions. Registration, brands, dependencies and dynamic context contracts still work, because they are data the plugin declares.
- **Imports are inspected before instantiation.** A WASM module lists the imports it needs. The kernel reads that list first and refuses modules that ask for powers they were not granted.
- **Resource limits.** Runtimes such as Wasmtime can stop runaway plugins with fuel or epoch interruption.
- **Official services stay in Node.** The FileSystem service keeps using Node's real `fs`. A caged plugin asks through an import; the kernel checks the request, the FileSystem service does the work, and plain data comes back. WASI pre-opened directories are the standard form of this pattern.
- **History becomes complete for caged code.** Every action a caged plugin takes passes through kernel-provided handles, so the history service sees and journals all of it.

APIs across the boundary must be message-shaped: plain serializable data, no live objects or closures. The same message design then serves three runtimes: direct calls in-process, imports and exports in WASM, and JSON-RPC for out-of-process services. That also opens the door to services written in Rust, Go, C and other languages.

## The code-loading capability

Any Level-1 service can introduce a new concept, such as an ExtensionManager that loads "extensions", so loading code must itself be a guarded capability with exactly one holder.

- **One frozen holder.** `brud.config.json` names which service holds the loader capability, and the kernel freezes that at boot. The kernel does not need to know it is the PluginManager; it only enforces that there is one. Like PID 1 on Linux: replaceable, but singular.
- **Untrusted loaders are confined, and their children with them.** A third-party ExtensionManager runs inside WASM, so anything it loads lives inside its cage too. The kernel never has to understand what an extension is.
- **Children ask the holder.** A loader that wants to load child code requests it through the code-loading capability, so the kernel tracks every child.
- **Attenuation.** A child can receive the parent's capabilities or fewer, never more.
- **Scoped child identities.** Each child gets its own brand under the parent's scope, such as `vendor.extmgr.child`, so history records exactly who did what and the kernel checks permissions per child. This prevents confused-deputy attacks, where a weak child tricks a stronger parent into acting for it.
- **Revocation cascades.** Uninstalling a loader revokes all of its children, and resource limits apply to the whole family.
- **A shared sandbox primitive.** Brud should offer a simple host function such as `instantiate(wasmBytes, capabilities)` that any loader can reuse, so the safe path is also the easiest path.

If a product owner declares a custom loader official, it is part of the trusted core, as with any other official code. Brud cannot police code it trusts, but it can be careful about what it trusts.

## Hardening the trusted tier

Official code is trusted, but the daemon process can still be locked down so that even trusted services cannot easily load arbitrary code.

- **Disable code from strings.** Run the daemon with `--disallow-code-generation-from-strings`, which turns off `eval` and `new Function` process-wide.
- **Node's permission model.** Newer Node.js versions can restrict file reads and writes, child processes and other powers per process. Restricting file reads to known directories blocks loading JavaScript from unexpected places.
- **Never rely on `vm`.** Node's `vm` module is not a security boundary and should not be used as one.
- **Dev-mode alerts.** Warn when a Level-1 service uses dynamic `import()`, `vm`, or reads code outside known paths. These warnings do not block; they make risky patterns visible to the product owner.

## What this does not solve

This proposal moves Brud from trusting every plugin to trusting a small core; it does not make the core itself safe.

- **The terminal service.** A caged plugin granted terminal access still runs commands on the real OS, and a command that passes policy can still write outside the workspace. That needs its own OS-level sandbox.
- **Bugs in host imports.** The cage is only as strong as its doors. A file import with a path-traversal bug (such as accepting `../../`) lets a plugin escape through it.
- **Over-granting.** A plugin granted both file reads and network access can read the user's data and send it out legitimately. Capabilities must stay narrow.
- **Compromised official code.** Official services and their dependencies keep full access, so a bug or supply-chain compromise there remains dangerous.
- **Caller identity.** The `owner: ai` versus `owner: ui` question concerns how the host application talks to the kernel and is separate from this proposal.

## Trade-offs

WASM is the lightest strong cage available, but it has real costs for plugin authors.

| Cost | Impact | Mitigation |
| --- | --- | --- |
| TypeScript does not compile to WASM directly | Running JS in WASM means embedding an engine such as QuickJS, which is slower | Offer SES compartments for JS/TS plugins |
| Many npm packages need Node APIs | Those packages will not work inside the cage | Kernel-provided capabilities replace the common needs; heavy cases use the sandboxed-process tier |
| Data crosses the boundary by copy | Passing large files is slower than in-process calls | Keep hot paths in official services; pass references or chunks |
| The Component Model and async support are still maturing, especially for Node | Rough tooling edges | Start with a small, stable import set |
| Debugging is harder than plain JavaScript | Slower plugin development | Good error messages and a local test harness |

By contrast, separate processes with OS sandboxes need different code for Linux, macOS and Windows and cost a process per plugin, which is why WASM is proposed as the default.

## Migration plan

This is best done now, before the stable release: there is no third-party ecosystem yet, so no one's plugins break.

The kernel core should barely change, since it already knows only services and its purity test guards that boundary. Most of the work is in the PluginManager and in reshaping any APIs that currently pass live objects or callbacks.

1. Add a message-shaped `kernel.call(service, method, args)` path alongside the current APIs.
2. Extend the official registry entries with package, version and integrity hash, and verify them at boot and at every runtime load.
3. Build a WASM host adapter in the PluginManager: instantiate modules, inspect imports, wire imports and exports, apply resource limits.
4. Port one simple plugin to WASM as a pilot.
5. Turn on the brand rule: third-party code must load as WASM or in an SES compartment.
6. Make the loader capability a single frozen holder declared in config.
7. Migrate remaining APIs to message-shaped calls as needed.

**Escape-test suite.** Alongside the existing tests, add hostile test plugins that try `require('fs')`, network calls, prototype tampering, path traversal through file imports, self-promotion to official, and acting as a second loader. Every attempt must fail.

## Open questions for the Lead Architect

These are decisions for Rahat; the proposal works with either answer to most of them.

- Should JS/TS third-party plugins default to SES compartments or to JS-in-WASM?
- Should cross-boundary contracts use WIT (the WASM Component Model's interface format), JSON Schema, or Brud's own schema built from the dynamic context contract?
- Does the loader capability live as a kernel primitive, or as a frozen config entry the kernel only enforces?
- How expensive is verifying hashes at every runtime load, and is caching by content hash acceptable?
- How should dependencies of official code be trusted: pinned hashes for the whole tree, or only for top-level packages?
- What workflow should a product owner follow to promote a third-party vendor to official?
- Should the terminal service get its own sandbox in the same release, since WASM does not cover it?
