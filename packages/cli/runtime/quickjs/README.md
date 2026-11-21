# The JavaScript guest runtime

`../quickjs.wasm` is QuickJS (quickjs-ng) behind the Brud cage's guest interface: it exports `brud_alloc` and `brud_invoke`, imports only `brud.call`, and holds one fixed slot (256 KiB) for the participant's bundled script. `brud pack` copies the runtime and writes the script into the slot (`src/commands/pack/javascript/slot.ts`); nothing is compiled per package.

| File | Role |
|---|---|
| `shim.c` | The guest interface, the script slot, and the call into QuickJS |
| `prelude.js` | Runs before the participant: removes `console` output and the clock, defines `brud.call` and the dispatcher |
| `stub-imports.mjs` | The cage provides no WASI, so every libc import is replaced with a local stub (the clock reads 0) |
| `build.sh` | Rebuilds `../quickjs.wasm` and writes its pinned digest to `src/commands/pack/javascript/runtimeInfo.ts` |

Rebuild (maintainers only): `WASI_SDK=... QUICKJS=... ./build.sh` from a folder where `npm i binaryen` was done. `brud pack` refuses a runtime whose SHA-256 differs from the digest pinned in the CLI. Provenance of the committed binary is in `runtimeInfo.ts`.

Measured with `-O2`; `-Oz` starts about 34% faster (432 ms against 650 ms) but runs about 1.8x slower, so it was not adopted.
