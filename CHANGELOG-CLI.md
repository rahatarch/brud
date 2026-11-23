# Changelog - Brud CLI

All notable changes to the Brud CLI (`@brud/cli`, the `brud` command) are listed here. The full notes for each release, with checksums and the attached tarballs, are on [GitHub Releases](https://github.com/rahatarch/brud/releases).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.0.2] - 2026-11-23

### Added
- **cli:** `brud seal [config]` generates the build seal for a composition: every official participant, in order, with a content hash. It writes `brud.seal.json` next to the config (or `--out`) and prints the digest to pass to `bootKernel`.
- **cli:** `brud init` interactively prompts whether to install packages now (`npm install`). Non-interactive `--install` and `--no-install` flags bypass the prompt.
- **cli:** `brud --version` and `brud --help` display the BrudOS wordmark, license, and copyright line at a terminal; piped output preserves bare version and help text.

### Changed
- **cli:** `brud check` and `brud doctor` report participants left out of the boot by the kernel as failures with remedial guidance and exit code 1.
- **cli:** `brud pack` provides descriptive diagnostic messages when a guest imports Node.js built-in modules (e.g., `fs`).
- **cli:** `brud init --kind` scaffolds kinds that declare operation permissions matching BrudOS 0.0.2 kernel requirements.

## [0.0.1] - 2026-11-22

The first public release of the Brud CLI (`brud`).

### Added
- **cli:** `brud init [name]` scaffolds a participant project that passes `doctor` and `npm test` (`--kind` for kind owners, `--guest` for caged guest projects in AssemblyScript, JavaScript, or TypeScript). Supports `--no-install` and deferred `brud init --finish`.
- **cli:** `brud doctor` and `brud check` validate host prerequisites, composition configuration, and daemon connectivity in isolation.
- **cli:** `brud run` and `brud call` boot a kernel or route documents through a running daemon.
- **cli:** `brud kinds` and `brud inspect` display registered kinds, exposures, and participant capability resolutions.
- **cli:** `brud add <package>` inspects external participant packages prior to local installation.
- **cli:** `brud pack` bundles and builds caged participant packages.

[0.0.2]: https://github.com/rahatarch/brud/releases/tag/cli-v0.0.2
[0.0.1]: https://github.com/rahatarch/brud/releases/tag/cli-v0.0.1
