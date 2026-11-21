# The Brud CLI

`brud` is one tool for your first hour: scaffold a project, check that everything is wired, run it, send it Brud text, and package a participant for the WASM cage. It is a thin tool on top of the public packages. It uses the same files, tokens and checks as any other client, and it has no back door into the kernel or the daemon.

## Install

```bash
npm install --save-dev @brud/cli
npx brud --help
```

`brud init` can also start a project from an empty folder (`npx @brud/cli init my-app`). The CLI loads `@brud/kernel`, `@brud/sdk` and `@brud/daemon` from your project, so it always reports on the versions your project really uses. It needs Node.js 22 or newer.

## The commands

| Command | What it does |
|---|---|
| `brud init [name]` | Creates a project: one participant, a test, a composition, scripts. `--kind` scaffolds a participant that owns a kind and routes Brud text. `--no-install` skips `npm install`. It writes only inside the target folder and never overwrites a file |
| `brud doctor [config]` | Read-only. Checks Node, the installed packages and their versions, the cage binary, the hardcore services, your composition and the daemon home. Every failure gets one line of cause and one line of fix |
| `brud check [config]` | Boots the composition in a scratch state and reports every problem. Exits 1 on any failure. Use it in CI |
| `brud run [config]` | Boots a kernel and routes each Brud document read from stdin (a document ends at a `[/BRUD]` line). `--daemon` starts the daemon in this process and goes through it |
| `brud call <text>` | Boots, sends one Brud document, prints the route result, and exits. `<text>` can be `-` for stdin, or use `--file`. Exit 1 when the route does not succeed |
| `brud kinds [config]` | Lists the kinds and operations the composition owns |
| `brud inspect [config]` | Lists participants, kinds, package exposures and requirements, and whether a caller with no capabilities, with the policy's capabilities, or with the `--cap` capabilities you name can resolve each exposure |
| `brud pack [dir]` | **Experimental.** Builds a caged participant package. See below |

Global options: `--json` (machine-readable output), `--home <dir>` (daemon home), `--no-color`, `--help`, `--version`. Session options for `run` and `call`: `--config`, `--state <dir>` (default `.brud/state` beside the composition), `--cap <capability>` (host capabilities, repeatable), `--tier ui|ai` (with `--daemon`), `--option key=value` (boot options, repeatable).

**Exit codes:** `0` success, `1` a problem was found or the command failed, `2` the command line was wrong.

## Try it

```bash
npx @brud/cli init my-notes --kind
cd my-notes
npm test
npx brud doctor
npx brud call $'[BRUD]\n[CALL note add]\ntext: buy milk\n[END]\n[CALL note list]\n[END]\n[/BRUD]'
```

The `--kind` scaffold owns the `note` kind (see [Own a kind and route text](own-a-kind-and-route-text.md)). Without `--kind` you get a participant that gives a capability-gated API and a test for it, and no kinds.

## What the CLI will not do

- It never marks a participant official and never edits `official` flags or pins. When a package needs official, `doctor` and `check` print the exact line you would add. You add it, or you do not.
- Read-only commands (`doctor`, `check`, `inspect`, `kinds`) write only inside throw-away scratch folders.
- `run` and `call --daemon` use the daemon's own token files, handshake and peer check. Token contents are never printed. The daemon admits only its spawning host, so `--daemon` starts the daemon inside the CLI process, and a separate `brud` process cannot attach to it.

## `brud pack` (experimental)

For the beta, `pack` supports one guest language, AssemblyScript, or a prebuilt `.wasm`. It bundles no compiler: it uses the `assemblyscript` package of your own project.

```bash
npx brud init guest-demo --guest      # a guest project: assembly/, brud.participant.src.json
cd guest-demo && npm install
npx brud pack --verify
```

`brud.participant.src.json` holds the participant's `id`, its `manifest`, the cage `limits` (`fuel`, `maxMemoryBytes`, optional `deadlineMs`), and the guest: `{ "source": "assembly/index.ts" }` or `{ "module": "guest.wasm" }`. `pack` writes `dist/participant.wasm` and `dist/brud.participant.json` with the module's SHA-256. `--verify` boots the package in a scratch kernel, as a participant that is not official, and checks that each exposure resolves only for callers holding the capabilities its policy asks for.

Limits of this beta:

- The guest library (`assembly/brud.ts`) handles the memory convention (`brud_alloc`, `brud_invoke`, `brud.call`) with raw JSON text. Parse it with a JSON library of your choice.
- A package that declares `requires` (it must run official) cannot be a caged module. `pack` refuses it, with `PACK_REQUIRES_OFFICIAL`.
- The kernel enforces fuel, memory and response-size limits. `--verify` does not try to break them. See [The WASM cage](../03-concepts/the-wasm-cage.md).

## Not in this release

`brud mcp` and `brud trust` are not shipped. The daemon has no MCP transport at present, and `trust` (print the config line and content hash for a package) is planned.

**Next:** [Your first participant](your-first-participant.md)
