# Building the WASM cage native binaries

The cage ships one native binary per platform in `native/`
(`brud-wasm-cage.<platform>.node`). Their SHA-256 digests are pinned in
`src/nativeDigests.ts`, and the hardcore pins in
`packages/kernel/src/bootstrap/hardcoreServices.ts` cover that table. The loader
refuses any binary whose digest is not listed, so **binaries and pins always
change together** — never hand-edit either.

Platforms: `linux-x64-gnu`, `linux-arm64-gnu`, `darwin-x64`, `darwin-arm64`,
`win32-x64-msvc`. Toolchain: Rust **1.99.1**, `--locked`.

## When you need a rebuild

Any change to `src/lib.rs`, `Cargo.toml`, `Cargo.lock` or `build.rs`. TypeScript
changes (`src/*.ts`) need only a re-pin, not a rebuild (see below).

## Rebuild all platforms (CI — the normal way)

The workflow `.github/workflows/cage-native.yml` runs automatically on a push to
`main` / `feat/**` that touches the files above. To run it by hand:

```bash
gh workflow run cage-native.yml --ref main
sleep 8 && gh run watch $(gh run list --workflow cage-native.yml --limit 1 --json databaseId -q '.[0].databaseId') --exit-status
```

What it does: **build** (5 platforms) → **repin** (regenerates the digest table
and all hardcore pins, then `repin --check`) → **verify** (builds the kernel, runs
`scripts/smoke-dist.mjs` and the caged tests on Linux x64/arm64, macOS arm64 and
Windows x64) → **pull-request** (opens `ci/cage-native-<run-id>` with the
binaries and pins). If nothing changed it exits with "binaries and pins unchanged".

Then merge the PR and update locally:

```bash
gh pr list --head "ci/cage-native-"   # find it
gh pr merge <number> --squash --delete-branch && git pull origin main
npm run build:kernel                  # dist/ must match the new pins
```

## Rebuild your own platform only (local, Linux x64)

```bash
cd packages/kernel/services/WasmCage
CARGO_TARGET_DIR=$HOME/cage-target ./build.sh   # builds and copies native/brud-wasm-cage.linux-x64-gnu.node
cd ../.. && npm run repin                       # digest table + pins, rebuilds dist/
node scripts/smoke-dist.mjs                     # built kernel boots and runs a caged participant
```

A local build only replaces your platform's binary; commit it only if you mean
to, and prefer CI for anything you ship. Build outside the repo's folder
(`CARGO_TARGET_DIR`) if the repo lives on a mounted or network drive.

## Re-pin only (TypeScript changes)

```bash
cd packages/kernel && npm run repin          # writes pins and rebuilds dist/
node --import tsx scripts/repin.ts --check   # what CI and prepack run: fails if stale
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `WASM_CAGE_NATIVE_TAMPERED` / "failed its digest check" | Binary changed without a re-pin. Run `npm run repin` (or rerun CI). |
| `WASM_CAGE_NATIVE_UNAVAILABLE` | No binary for this platform (e.g. linux-musl). The kernel still boots; only caged participants are unavailable. |
| `HARDCORE_VERIFICATION` content-hash mismatch on Windows only | CRLF checkout. `.gitattributes` forces LF; re-clone or `git add --renormalize .` if an old checkout. |
| pull-request job: "GitHub Actions is not permitted to create or approve pull requests" | Enable Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests", or open the PR from the pushed `ci/cage-native-*` branch with `gh pr create`. |
| `repin --check` fails in prepack | Pins are stale: `npm run repin`, commit the result. |
| `npm run build:kernel` fails with `ENOTEMPTY` | A process still holds files in `dist/` open (editor TS server, background tools). Close it and rerun. |
