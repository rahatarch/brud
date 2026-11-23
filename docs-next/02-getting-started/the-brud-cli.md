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
| `brud init [name]` | Creates a structured project: `brud.config.json`, `src/participants/<name>/`, `test/participants/`, `config/` (a daemon operator-config example), `docs/`, a CI workflow, `package.json` scripts, a README, `.editorconfig`, `.nvmrc` and `.gitignore`. `--kind` scaffolds a participant that owns a kind and routes Brud text, with a sample document in `examples/`. `--guest [--lang as|js|ts]` scaffolds a caged guest project instead. `--no-install` skips `npm install`; the project is then created without `brud.config.json` (it lists the kernel's services, so it needs the installed kernel), and `brud init --finish [dir]` writes just that file after `npm install`. It writes only inside the target folder and never overwrites a file |
| `brud doctor [config]` | Read-only. Checks Node, the installed packages and their versions, the cage binary, the hardcore services, your composition and the daemon home. Every failure gets one line of cause and one line of fix |
| `brud check [config]` | Boots the composition in a scratch state and reports every problem. Exits 1 on any failure. Use it in CI |
| `brud run [config]` | Boots a kernel and routes each Brud document read from stdin (a document ends at a `[/BRUD]` line). `--daemon` starts the daemon in this process and goes through it |
| `brud call <text>` | Boots, sends one Brud document, prints the route result, and exits. `<text>` can be `-` for stdin, or use `--file`. Exit 1 when the route does not succeed |
| `brud kinds [config]` | Lists the kinds and operations the composition owns |
| `brud inspect [config]` | Lists participants, kinds, package exposures and requirements, and whether a caller with no capabilities, with the policy's capabilities, or with the `--cap` capabilities you name can resolve each exposure |
| `brud add <package>` | Adds a Brud participant package. It first downloads the exact tarball and inspects it **without running or importing any of its code**: it must contain a valid `brud.participant.json`, the cage module must match its sha256, its `@brud/kernel` range must include yours, and its exposure names must not collide with your composition. A caged package is also booted in a scratch kernel. Only then does it run `npm install --ignore-scripts` and check the installed bytes against the inspected ones. It prints the composition line to add. It never declares anything `official`; `--write` adds a not-official entry for a caged package only. `--dry-run` stops after inspection; `--allow-scripts` lets install scripts run. This checks that a package is a well-formed, compatible Brud package, not that it is safe or trustworthy |
| `brud pack [dir]` | **Experimental.** Builds a caged participant package. See below |

Global options: `--json` (machine-readable output), `--home <dir>` (daemon home), `--no-color`, `--help`, `--version`. Session options for `run` and `call`: `--config`, `--state <dir>` (default `.brud/state` beside the composition), `--cap <capability>` (host capabilities, repeatable), `--tier ui|ai` (with `--daemon`), `--option key=value` (boot options, repeatable).

**Exit codes:** `0` success, `1` a problem was found or the command failed, `2` the command line was wrong.

## Try it

```bash
npx @brud/cli init my-notes --kind
cd my-notes
npm test
npm run doctor
npm run call -- --file examples/notes.brud
```

The `--kind` scaffold owns the `note` kind (see [Own a kind and route text](own-a-kind-and-route-text.md)). Without `--kind` you get a participant that gives a capability-gated API and a test for it, and no kinds.

## What the CLI will not do

- It never marks a participant official and never edits `official` flags or pins. When a package needs official, `doctor` and `check` print the exact line you would add. You add it, or you do not.
- Read-only commands (`doctor`, `check`, `inspect`, `kinds`) write only inside throw-away scratch folders.
- `run` and `call --daemon` use the daemon's own token files, handshake and peer check. Token contents are never printed. The daemon admits only its spawning host, so `--daemon` starts the daemon inside the CLI process, and a separate `brud` process cannot attach to it.

## `brud pack` (experimental)

`pack` turns a guest folder into a participant package the WASM cage can run. A guest can be written in:

| Language | How it runs | Speed |
|---|---|---|
| **AssemblyScript** (`.ts` under `assembly/`) | Compiled ahead of time to WebAssembly with the `assemblyscript` package of your own project | About native speed (measured at 1.1x to 1.5x of V8) |
| **JavaScript or TypeScript** (`.js`, `.mjs`, `.ts` with `"language": "javascript"`) | Bundled (types removed) with your project's `esbuild` into a prebuilt JavaScript runtime (QuickJS) that ships with the CLI. It runs as an interpreter inside the cage | Much slower on heavy work: see the numbers below |
| A prebuilt `.wasm` | Used as is | Whatever you built |

```bash
npx brud init guest-demo --guest --lang ts   # or --lang js, or --lang as (the default)
cd guest-demo && npm install
npx brud pack --verify
```

`brud.participant.src.json` holds the participant's `id`, its `manifest`, the cage `limits` (`fuel`, `maxMemoryBytes`, optional `deadlineMs`), and the guest: `{ "source": "assembly/index.ts" }`, `{ "source": "src/index.ts", "language": "javascript" }`, or `{ "module": "guest.wasm" }`. A `.js` or `.mjs` source is JavaScript by itself; a `.ts` source is AssemblyScript unless it says `"language": "javascript"`. `pack` writes `dist/participant.wasm` and `dist/brud.participant.json` with the module's SHA-256. `--verify` boots the package in a scratch kernel, as a participant that is not official, and checks that each exposure resolves only for callers holding the capabilities its policy asks for.

### Writing a JavaScript or TypeScript guest

```js
// src/index.js
export default function handler(request) {
  // request: { kind, exposure, method, args, caller: { identity, callerClass, official, capabilities, origin } }
  if (request.method === 'add') {
    return request.args[0] + request.args[1];
  }

  throw Object.assign(new Error('unknown method'), { code: 'UNKNOWN_METHOD' });
}
```

Return any JSON value; throw to refuse (a `code` on the error is kept). `brud.call(name, method, args)` asks the kernel to call another exposure as this participant, with exactly what its manifest requested and the givers allow. There is no Node in the cage: no `process`, files, network, `console` or clock, and importing a Node built-in such as `fs` fails the build with `PACK_COMPILE_FAILED`, and the message says the cage has no Node modules. Handlers are synchronous. Types are removed, not checked (run `tsc --noEmit`). The bundled script may be up to 256 KiB.

What it costs, measured in the real cage on one Linux x64 machine (Node 22; your numbers will differ):

| Work | Native JS (V8) | AssemblyScript in the cage | JavaScript in the cage |
|---|---|---|---|
| Empty call | 0.001 ms | 0.005 ms | 0.014 ms |
| fib(20) | 0.06 ms | 0.07 ms | 1.7 ms |
| 1 million loop steps | 0.9 ms | 1.3 ms | 168 ms |
| 10 million loop steps | 9 ms | 10 ms | 1,670 ms |
| Starting the participant | none | about 11 ms | about 650 ms |

The interpreter spends about 2,000 units of cage fuel per simple loop step (AssemblyScript: about 22), so give JavaScript guests a large `limits.fuel` (the scaffolded project uses 3,000,000,000) and at least 16 MiB of `maxMemoryBytes`. The benchmark and its method are in `benchmarks/cage-languages/`.

The runtime is a prebuilt, digest-pinned file in the CLI package. `pack` refuses it if it does not match the digest in the CLI's code. Maintainers rebuild it with `packages/cli/runtime/quickjs/build.sh` (it needs a wasi-sdk; users do not).

### Limits of this beta

- The AssemblyScript guest library (`assembly/brud.ts`) handles the memory convention (`brud_alloc`, `brud_invoke`, `brud.call`) with raw JSON text. Parse it with a JSON library of your choice.
- A package that declares `requires` (it must run official) cannot be a caged module. `pack` refuses it, with `PACK_REQUIRES_OFFICIAL`.
- The kernel enforces fuel, memory and response-size limits. `--verify` does not try to break them. See [The WASM cage](../03-concepts/the-wasm-cage.md).

## Not in this release

`brud mcp` and `brud trust` are not shipped. The daemon has no MCP transport at present, and `trust` (print the config line and content hash for a package) is planned.

**Next:** [Your first participant](your-first-participant.md)
