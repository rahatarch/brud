# Brud CLI plan

Status: proposed. Owner: maintainers. Target: `brud` binary in a new package, `@brud/cli`.

## Why

The beta trial of BrudOS as an installed package showed that the hard parts for a new developer are not the APIs but the setup around them: scaffolding a project, wiring a composition, knowing what a config means for trust, and packaging a participant for the WASM cage. Each of those is currently a manual step or a hand-written script. A CLI turns them into commands, and it is also where the security model becomes visible (who is official, who can see what).

## Goals

- One tool for the first hour: create, check, run and package.
- Read-only diagnostics that explain trust decisions without making them.
- A supported path to the WASM cage, so that sandboxing is not limited to people who can write WebAssembly by hand.
- The same behaviour on Linux, macOS and Windows, on every supported Node version.

## Non-goals

- Replacing `brud-daemon`. The daemon keeps its own binary; the CLI wraps it.
- Changing any trust rule. The CLI never marks a participant official and never edits a composition's `official` flags without the owner doing it.
- A package registry or marketplace.
- Running JavaScript inside the cage. That is a separate project (see Open questions).

## Package

- New workspace package `@brud/cli`, binary `brud`.
- Depends on `@brud/kernel`, `@brud/sdk`, `@brud/daemon` and `@brud/protocol`.
- Reads names, error codes, the hardcore list and the config shape from the kernel at runtime. It does not keep its own copy, so it cannot go stale.
- Node `>=22`, matching the other packages. ESM only. No dependency that needs a native build.

## Commands

| Command | Behaviour | Release |
|---|---|---|
| `brud doctor` | Read-only environment and composition check (below) | Beta |
| `brud init [name]` | Scaffolds a project: one native participant, a test, a composition, scripts | Beta |
| `brud check [config]` | Boots the composition in a scratch state and reports pruned participants, exposure collisions, owner-pin conflicts, missing capabilities and `official` problems. Exit code is non-zero on any error | Beta |
| `brud run [config]` | Boots a kernel (or starts the daemon with `--daemon`) from a composition | Beta |
| `brud call <text>` | Sends Brud text to a running kernel or daemon and prints the route result. Takes `--tier ui\|ai` and `--cap <capability>` | Beta |
| `brud kinds` / `brud inspect` | Lists kinds, operations, exposures and their policies, and who can resolve each | Beta |
| `brud pack` | Builds a participant package: compiles the guest, writes `cage.sha256` and `brud.participant.json` | Experimental |
| `brud mcp` | Exposes a daemon through MCP for AI clients | After the daemon's MCP transport is tested |

Global flags: `--json` for machine-readable output, `--home <dir>`, `--no-color`. Every command has a documented exit code.

### `brud doctor`

Never changes anything. Checks, in order:

1. Node version against the package `engines`.
2. A cage binary exists for this platform (`WASM_CAGE_NATIVE_UNAVAILABLE` otherwise).
3. Every hardcore verifies against its content hash.
4. The composition parses, every entry resolves, and each is one of: official native, participant package, or an error.
5. Every hardcore entry is `official: true`.
6. Exposure names do not collide, and `exposureOwners` pins are satisfiable.
7. The daemon home exists, token files are owner-only, and `daemon.json` is valid. `composition` resolves relative to the `daemon.json` folder.
8. Each participant's requested capabilities, against what its exposure policies need, flagging requests nobody can grant.

Output is a checklist with one line of cause and one line of fix per failure.

### `brud init`

Creates a project that passes `brud doctor` and `npm test` on first run:

- `participants/<name>.mjs` using `defineParticipant`, with one capability-gated exposure,
- `test/<name>.test.mjs` using `bootTestKernel`,
- `brud.config.json` listing the hardcores and the participant,
- `package.json` with `test`, `check` and `run` scripts.

A `--kind` template adds a participant that owns a kind and routes Brud text. The templates are the tested examples from `docs-next/examples`, so docs and scaffold cannot drift.

### `brud pack`

For the beta this is experimental and limited to one guest language. AssemblyScript is the first candidate because it compiles to WebAssembly from a TypeScript-like source and installs through npm.

- Input: a guest source folder with a `brud.participant.src.json` (id, manifest, limits).
- Output: `participant.wasm`, and `brud.participant.json` with the module's SHA-256.
- A small guest library handles the memory and JSON convention (`brud_alloc`, `brud_invoke`, `brud.call`), so the author writes `invoke(exposure, method, args, caller)`.
- `brud pack --verify` loads the result into a scratch kernel and calls each exposure once, including the failure paths (fuel, memory, response size).

## Security rules for the CLI itself

- Read-only commands (`doctor`, `check`, `inspect`) must not write outside a scratch directory.
- `brud run` and `brud call` use the same token files and peer checks as any other client. There is no CLI back door.
- `brud init` writes only inside the target folder and refuses to overwrite existing files.
- No command changes `official` flags or pins. It may print the exact line the owner would add.
- Output never prints token contents.

## Testing

- A `brud` command test suite runs in the existing CI matrix (Ubuntu, macOS, Windows, Node 22, 24 and 26).
- `brud init` output is generated into a temp folder and tested with `brud doctor` and `npm test`.
- Path handling uses the same helpers that fixed the Windows CI failures (`file://` imports, normalised separators).
- Packaging test: `npm pack` of `@brud/cli` installed into a scratch project, as done for the other packages.

## Milestones

1. **`doctor`**. It forces the "what can go wrong" list into code. It also needs the kernel to expose the hardcore list and verification (currently internal).
2. **`init`**, with tested templates from `docs-next/examples`.
3. **`check`, `run`, `call`, `inspect`**.
4. **`pack`** with the AssemblyScript template. Experimental.
5. **`mcp`**, after the daemon MCP transport has its own security tests.

## Open questions

- **JavaScript in the cage.** The real answer to "write a normal participant and have it sandboxed" is a JS engine compiled to WebAssembly (for example QuickJS) shipped as the cage's guest runtime. It is a large project with its own size, speed and security review, and it should be decided separately from `pack`.
- **Which kernel internals become public.** `doctor` needs the hardcore list and hash verification as exports. That widens the public API, so it needs a deliberate decision, not a deep import.
- **MCP.** The daemon has an MCP transport that is untested. Is it the supported way for AI clients to connect, or is Brud text over the daemon enough?
- **Name and version.** `@brud/cli` follows the other packages' versioning, starting at `0.0.1`.

## Definition of done for the beta

- `brud doctor`, `init`, `check`, `run`, `call` and `inspect` work and have documented exit codes.
- A new user can run `npx @brud/cli init demo && cd demo && npm test` and pass.
- Every command is covered in `docs-next` with a runnable example.
- CI is green on all three operating systems and all three Node versions.
- `pack` is documented as experimental, with its limits stated.
