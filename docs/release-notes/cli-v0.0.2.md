# Brud CLI 0.0.2

## Summary
This release of the Brud CLI adds `brud seal` for builders who ship a BrudOS product, and makes `brud check` and `brud doctor` tell you when the kernel left a participant out of the boot. `brud init` now asks whether to install the packages, and `brud --version` shows the BrudOS wordmark. It also explains why `brud pack` rejects a Node module, and scaffolds kinds that match BrudOS 0.0.2. Use it with `@brud/kernel` 0.0.2 or later.

## Changes
### Added
- **cli:** `brud seal [config]` generates the build seal for a composition: every official participant, in order, with a content hash. It writes `brud.seal.json` next to the config (or where `--out` says) and prints the digest that the built product passes to `bootKernel` together with the seal file. Running it twice on the same build gives the same digest. ([`db56698`](https://github.com/rahatarch/brud/commit/db56698c886f34030e8094e7989587de81bba2ce))
- **cli:** `brud init` asks, at a terminal, whether to install the packages now and runs `npm install` when you say yes. `--install` and `--no-install` answer without asking, and a guest project asks too. With nobody to ask, a project installs and a guest project does not, as before. ([`2f7e17f`](https://github.com/rahatarch/brud/commit/2f7e17f13d41be44fe149bb1e21913fb4add7106))
- **cli:** `brud --version` and `brud --help` show the BrudOS wordmark at a terminal, and `--version` also prints the licence and the copyright line. Piped output stays the bare version and the plain help, so scripts are not affected. ([`52a8822`](https://github.com/rahatarch/brud/commit/52a8822037ab17b06be802918d32fb2246dc5ab1), [`ed20d4f`](https://github.com/rahatarch/brud/commit/ed20d4fef26e88902e70285e9ecbf668ff6811cc))

### Changed
- **cli:** `brud check` and `brud doctor` report each participant the kernel left out of the boot as a failure, with the reason and what to do, and exit 1. Before, a composition that booted without one of its participants passed. ([`6241379`](https://github.com/rahatarch/brud/commit/6241379f3f5cee32d9c74d30b3b13dc6436847ca))
- **cli:** `brud pack` says that the cage has no Node modules and to remove the import when a guest imports a Node built-in such as `fs`, instead of only `Could not resolve "fs"`. ([`3415171`](https://github.com/rahatarch/brud/commit/341517158719bbf5b5346cfdf7a3db0fd6b50db1))
- **cli:** `brud init --kind` scaffolds a kind that declares the permission its operations need, as BrudOS 0.0.2 requires. ([`cbfbdbb`](https://github.com/rahatarch/brud/commit/cbfbdbbac5a3161c71359d4a2d605e728c4948cc))

## Upgrade notes
- Install it together with `@brud/kernel`, `@brud/sdk` and `@brud/daemon` 0.0.2. `brud seal` needs the 0.0.2 kernel, and a kind scaffolded by `brud init --kind` is refused by a 0.0.1 kernel.
- A project made with an earlier CLI keeps working. To use the seal, run `brud seal` once per release after the build is final, and keep the printed digest inside the product, not next to the config.

## Known issues
- The CLI loads the kernel, SDK and daemon from your project and does not bundle them. After a global install, only `--version`, `--help` and `init --no-install` work outside a project; run the other commands inside a project that has those packages installed.
