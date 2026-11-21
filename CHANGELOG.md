# Changelog

All notable changes to BrudOS (`@brud/kernel`, `@brud/sdk`, `@brud/daemon` and `@brud/protocol`, released together at one version) are listed here. The full notes for each release, with checksums and the attached tarballs, are on [GitHub Releases](https://github.com/rahatarch/brud/releases).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.0.1] - 2026-11-21

The first public release.

### Added
- **kernel:** Boots a composition of participants, gives each one a kernel-issued identity, and enforces on every call what the owner of an API allows. Includes the seven built-in core services, verified against pinned content hashes at boot.
- **kernel:** Runs participants that are not declared official inside a WebAssembly sandbox (Wasmtime, fuel-limited, no operating-system access). Prebuilt sandbox binaries ship for Linux (x64, arm64), macOS (x64, arm64) and Windows (x64).
- **sdk:** `defineParticipant` and `byCapability` for writing participants, and `bootTestKernel` for testing them against a real kernel.
- **daemon:** A local background host that boots kernels on request and serves them over an authenticated, encrypted local connection, with separate `ui` and `ai` caller tiers.
- **protocol:** The shared message types, method names and error codes (protocol version 1.0.0) used by the daemon and its clients.

[0.0.1]: https://github.com/rahatarch/brud/releases/tag/v0.0.1
