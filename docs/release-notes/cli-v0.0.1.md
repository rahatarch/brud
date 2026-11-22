# Brud CLI 0.0.1

## Summary
The first public release of the Brud CLI, the `brud` command for setting up, checking, running and calling BrudOS projects. Install it in a project that has `@brud/kernel`, `@brud/sdk` and `@brud/daemon` 0.0.x, and use it to scaffold a participant, check the machine and the composition, send Brud text through the kernel, and package a participant for the WASM cage.

## Changes
### Added
- **cli:** `brud init [name]` scaffolds a project that passes `doctor` and `npm test` (`--kind` for a kind owner with a sample document, `--guest` for a caged guest project in AssemblyScript, JavaScript or TypeScript). With `--no-install` it creates the project and `brud init --finish` writes `brud.config.json` once the kernel is installed.
- **cli:** `brud doctor` and `brud check` report problems with the machine, the composition and the daemon without changing anything (`check` boots the composition in a scratch state).
- **cli:** `brud run` and `brud call` boot a kernel, or the daemon, and route Brud text or send one document and print the result.
- **cli:** `brud kinds` and `brud inspect` show the kinds, exposures and requirements in a composition and who can resolve each.
- **cli:** `brud add <package>` inspects a participant package before it is installed.
- **cli:** `brud pack` builds a caged participant package (experimental).

### Known issues
- The CLI loads the kernel, SDK and daemon from your project and does not bundle them. After a global install, only `--version`, `--help` and `init --no-install` work outside a project; the other commands need a project that has those packages.
