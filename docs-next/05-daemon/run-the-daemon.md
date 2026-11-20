# Run the daemon

This page shows how to start the daemon and configure it with `daemon.json`.

## Start it

```bash
brud-daemon --home ~/.brud --foreground
```

| Flag | Meaning |
|---|---|
| `--home <dir>` | Daemon home. Falls back to `BRUD_DAEMON_HOME`, then `~/.brud` |
| `--config <file>` | Operator config path. Falls back to `BRUD_DAEMON_CONFIG`, then `<home>/daemon.json` |
| `--idle-ms <n>` | Daemon idle timeout in milliseconds |
| `--instance-idle-ms <n>` | Idle timeout for each hosted kernel |
| `--foreground` | Silences the foreground notice. The daemon always runs in the foreground |

Unknown `--` flags are refused. The only socket peer admitted is the process that started the daemon (its parent), so launch it from the program that will use it. `SIGINT` and `SIGTERM` shut it down cleanly.

## The operator config: `daemon.json`

Read once at start and then frozen.

```json
{
  "composition": "./brud.config.json",
  "fixedOptions": {},
  "clientOptions": [],
  "principals": { "ui": [], "ai": [] },
  "reuseIdenticalBoots": false
}
```

| Key | Meaning |
|---|---|
| `composition` | Required. Path to the `brud.config.json` every kernel boots. Relative paths resolve against this file's folder, not the daemon home or your working directory |
| `fixedOptions` | Startup options the operator sets. Clients can never override them |
| `clientOptions` | Names of startup fields a client may set in `kernel.boot` |
| `principals` | Host-call capabilities granted to each caller tier, `ui` and `ai` |
| `reuseIdenticalBoots` | Reuse a running kernel when a boot request has identical options |

Unknown keys are refused (`DAEMON_OPERATOR_CONFIG_INVALID`).

For example, with `--home ./daemon-home/prod` and the config at `./daemon-home/prod/daemon.json`, a composition kept two levels up at the project root is `"composition": "../../brud.config.json"`. A composition inside the same folder is `"./brud.config.json"`.

## What lives in the home

- `daemon.json` and your composition, which you provide.
- A local socket and one secret token file per caller tier (`ui`, `ai`), created with owner-only permissions each time the daemon starts.
- `kernels/<name>/` with each kernel's state. Kernels booted with identical options get separate folders.

Treat token files like passwords. Whoever can read one can talk to the daemon as that tier.

**Next:** [Connect a client](connect-a-client.md)
