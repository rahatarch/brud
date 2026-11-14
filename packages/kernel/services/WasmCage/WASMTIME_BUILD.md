# Wasmtime build record

The cage's runtime is vendored, not installed: the cage is a plain directory inside
the kernel package, matching the four existing hardcore services, and the kernel
package declares no runtime dependency. The `.node` under `native/` is a build
artifact of the cage's own napi-rs wrapper over the Wasmtime crate. It is **not** a
third-party runtime package and must not be replaced by a package dependency.

## Versions

| Component | Version | Source |
|---|---|---|
| `wasmtime` crate | `=50.0.0` | crates.io, `registry+https://github.com/rust-lang/crates.io-index` |
| `wasmtime-wasi` crate | `=50.0.0` | crates.io, same registry |
| `napi` crate | `=3.16.2` | crates.io |
| `napi-derive` crate | `=3.7.1` | crates.io |
| `napi-build` crate | `=2.6.0` | crates.io |
| Rust toolchain | `rustc 1.99.1 (58cf8f9c3 2026-10-13)` | rustup `stable-x86_64-unknown-linux-gnu`, pinned by the installed compiler; no `rust-toolchain.toml` because a named channel adds only a redundant download of the same 1.99.1 compiler |
| Cargo | `cargo 1.99.1 (5f94df478 2026-08-27)` | same toolchain |

The Wasmtime crate is pinned with `=` so a rebuild cannot silently move to a newer
release. `Cargo.lock` is committed; `cargo build --locked` refuses any change to the
resolved graph.

## Build command

```
cd packages/kernel/services/WasmCage
cargo build --release --locked
mkdir -p native
cp target/release/libbrud_wasm_cage.so native/brud-wasm-cage.linux-x64-gnu.node
```

`build.sh` runs exactly this. The build takes about 80 seconds warm and about 3
minutes from a cold `target/`.

## Artifact

| Property | Value |
|---|---|
| Path | `packages/kernel/services/WasmCage/native/brud-wasm-cage.linux-x64-gnu.node` |
| Size | 11,033,344 bytes |
| SHA-256 | `62e57fd0b4d691e4742f8354edd40f638b1722fb715a19f2733de03bba27760f` |
| Platform | `linux-x64-gnu` (`x86_64-unknown-linux-gnu`), ELF 64-bit LSB shared object, stripped |

Other platforms need their own build: `darwin-arm64`, `darwin-x64`,
`linux-arm64-gnu`, `win32-x64-msvc`. Only the current platform's artifact is
committed.

## Exposed surface

The wrapper exposes exactly four things, and nothing Wasmtime does not provide:

- `CageEngine` — constructs the engine with a fixed configuration (fuel on,
  bulk memory on, multi-memory/threads/reference-types/memory64 off).
- `CageModule.compile(engine, bytes)` — compiles a module from bytes.
- `CageInstance.instantiate(module, imports, limits)` — instantiates with the
  caller's declared imports only. Default-deny: an import not declared is refused
  by Wasmtime's linker with `unknown import`.
- `CageInstance.callI32(name, arg)` and `CageInstance.fuelRemaining()` — one
  integer call entry point and one resource read.

`ResourceLimits` carries Wasmtime's three limits: `fuel`, `maxMemoryBytes`,
`timeoutMs`. The routed-call host function returns the cage's stable
capability-denial code (0) at this layer; the cage's TypeScript layer supplies
the real routed call in a later step.

## Verification

`verify.mjs` runs five checks against the real binary and real `.wasm` byte
streams. All pass:

1. A trivial module with no imports returns 42.
2. A module declaring an ungranted import fails to instantiate:
   `unknown import: kernel::call has not been defined`.
3. Modules importing `node.require`, `global.process`, and `process.env` are all
   refused — Node globals are unreachable.
4. A declared routed-call import instantiates and calls.
5. An unbounded loop exhausts fuel: `wasm trap: all fuel consumed by WebAssembly`.