# Troubleshooting

Common problems, their causes, and fixes. Each entry starts with the symptom.

**`resolve` returns `null`.** Either the exposure does not exist, or the giver refused you. Use `registry.lastRefusal()` to inspect the exact refusal reason without exposing unpublished declarations. Check the name and version, your caller's capabilities, and the exposure's scope against your origin (a host chain never passes `runtime`). The host can also read detailed denial reasons from `kernel.readObservations()`.

**`EXPOSED_API_UNAVAILABLE` when using a handle.** You used it after the call ended. Resolve and use it inside the same call.

**My participant is missing after boot.** If it is a loaded (non-official) participant, it failed admission or startup and was left out; inspect `kernel.abandoned` or run `brud check` / `brud doctor` to see the exact reason and code. If an official participant is missing a required startup option, boot is refused entirely with a typed error naming the missing field and scope (missing options are never silently pruned).

**`MODULE_RESOLVE`.** Use an absolute path or package name in `services[].path`. Native modules must be declared `official: true` in your composition (or sealed for release builds). Non-official code must be packaged for the WASM cage.

**`CONFIG_INTEGRITY` while deleting a temp config.** The kernel is still running. Call `kernel.shutdown()` first.

**Kernel tests flake when run in parallel.** Run them serially.

**Services tests fail to find a config.** Set `BRUD_STANDARD_CONFIG` to the standard composition file.

**`@brud/sdk` cannot be imported from a temp folder.** Use `{ path }` entries for modules, not `source:` entries, in test compositions.

**Daemon refuses my connection.** Only the launching process is admitted as peer. Start the daemon from the program that connects, and use the matching tier's token.

**Daemon behaves like old code.** Rebuild `@brud/protocol` and `@brud/daemon` so `dist` is current.

Still stuck? See [Error codes](error-codes.md).
