# Example daemon operator config

`daemon.json` is the operator-owned configuration the daemon reads once at start
(`<home>/daemon.json`). Copy both files into your daemon home and edit them.

- `composition`: the composition every kernel boots. `foundation.config.json`
  here is the Foundation composition (kernel hardcores plus the official
  services). Relative paths resolve against `daemon.json`.
- `fixedOptions`: startup options the operator sets; a client can never override them.
- `clientOptions`: startup field names a client may set in `kernel.boot`.
  `workspace.root` lets each client pick its workspace.
- `principals`: host-session capabilities granted to the authenticated `ui` and `ai`
  callers. Empty lists grant nothing; list capability names to grant them.
- `reuseIdenticalBoots`: when true, a boot with identical options attaches to the
  running kernel instead of starting another.

Each kernel keeps its state under `<home>/kernels/<name>/`. The daemon itself knows
no participant and no domain concept; everything domain-specific lives in the
composition and in the options above.
