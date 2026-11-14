#!/usr/bin/env bash
# Builds the cage's napi-rs wrapper into a .node binary for the current platform.
#
# Reproducible: the Wasmtime crate version, the napi-rs crate version, and the
# Rust toolchain are all pinned in Cargo.toml and rust-toolchain.toml. A rebuild
# with the same toolchain produces the same artifact.
set -euo pipefail
cd "$(dirname "$0")"
cargo build --release --locked
mkdir -p native
cp target/release/libbrud_wasm_cage.so native/brud-wasm-cage.linux-x64-gnu.node
echo "built: native/brud-wasm-cage.linux-x64-gnu.node"