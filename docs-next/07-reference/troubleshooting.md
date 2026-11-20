# Troubleshooting

**`resolve` returns `null`.** Either the exposure does not exist, or the giver refused you. Check the name and version, your caller's capabilities, and the exposure's scope against your origin (a host chain never passes `runtime`). The host can read the real reason from `kernel.readObservations()`.

**`EXPOSED_API_UNAVAILABLE` when using a handle.** You used it after the call ended. Resolve and use it inside the same call.

**My participant is missing after boot.** It was probably pruned for a missing required startup field. Look for a kernel warning, and pass the option in `bootKernel`.

**`MODULE_RESOLVE`.** Use an absolute path in `services[].path`, and set `official: true`. Non-official native modules are refused in this beta.

**`CONFIG_INTEGRITY` while deleting a temp config.** The kernel is still running. Call `kernel.shutdown()` first.

**Kernel tests flake when run in parallel.** Run them serially.

**Services tests fail to find a config.** Set `BRUD_STANDARD_CONFIG` to the standard composition file.

**`@brud/sdk` cannot be imported from a temp folder.** Use `{ path }` entries for modules, not `source:` entries, in test compositions.

**Daemon refuses my connection.** Only the launching process is admitted as peer. Start the daemon from the program that connects, and use the matching tier's token.

**Daemon behaves like old code.** Rebuild `@brud/protocol` and `@brud/daemon` so `dist` is current.

Still stuck? See [Error codes](error-codes.md).
