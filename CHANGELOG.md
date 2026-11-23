# Changelog

All notable changes to BrudOS (`@brud/kernel`, `@brud/sdk`, `@brud/daemon` and `@brud/protocol`, released together at one version) are listed here. For the Brud CLI (`@brud/cli`), see [packages/cli/CHANGELOG.md](packages/cli/CHANGELOG.md). The full notes for each release, with checksums and the attached tarballs, are on [GitHub Releases](https://github.com/rahatarch/brud/releases).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.0.2] - 2026-11-23

### Breaking changes
- **kernel:** A kind must list every operation it serves, each with a permission of its own or the kind's default, or the boot is refused. A kind whose operation names only exist at runtime declares `operations: 'open'` with a kind-level permission.
- **kernel:** A required boot option that the host did not supply, or supplied in the wrong shape, refuses the boot for every participant, with one error naming each missing field, scope and participant.
- **daemon, protocol:** Removed the `pruned` list because participants are no longer silently excluded for missing options.
- **kernel:** `caller.capabilities` is now a read-only view in exposures, kind dispatch and interceptors. It is neither a `Set` nor an array: use `has()`, `size` and iteration.
- **kernel:** An interceptor that declares no `stages` now takes part in the output stage only. To inspect or alter call arguments, declare `stages: ['input']`.
- **kernel:** A participant that is not declared official and cannot be loaded, admitted or started is left out and the kernel boots without it; details are in `kernel.abandoned`.
- **kernel:** Removed the unused `PluginMetadata` type and the `metadata` field of `OperationHandler`.

### Added
- **kernel:** Host can reload a running kernel via `reload({ configPath? })`. The new config is composed before the old kernel is stopped. Official participants sealed by the build cannot be altered during a reload (`CONFIG_RELOAD_FROZEN`).
- **kernel:** Loaded (non-official) participants run caged and fail soft: failing to start leaves them out without stopping the kernel boot.
- **kernel:** Built compositions can be sealed with `createSeal`, verified at boot against content hashes and digests (`SEAL_MISMATCH`, `SEAL_VIOLATION`, `PARTICIPANT_NOT_SEALED`).
- **kernel:** Interceptors can append to a giver's result during the output stage. Unhandled exceptions or oversize results skip the interceptor without discarding the primary result.
- **kernel:** The router enforces declared operations and caller permissions before invoking kind handlers (`operation_not_declared`, `permission_denied`).
- **kernel, sdk:** `lastRefusal()` provides the reason why the most recent `resolve` returned `null`.
- **sdk:** `defineParticipant` accepts `events`, `interceptions`, `interceptionPoints` and `kinds`.

### Changed
- **kernel:** Caged guests stopped at resource limits report stable reason codes (`CAGE_FUEL_LIMIT` or `CAGE_MEMORY_LIMIT`) with diagnostic details.

### Fixed
- **kernel:** Interception `admit` validates token ID strings and reports descriptive token errors.

### Security
- **kernel:** Immutable `caller.capabilities` view prevents participants from modifying caller capabilities records to bypass downstream exposure access checks.

## [0.0.1] - 2026-11-21

The first public release.

### Added
- **kernel:** Boots a composition of participants, gives each one a kernel-issued identity, and enforces on every call what the owner of an API allows. Includes the seven built-in core services, verified against pinned content hashes at boot.
- **kernel:** Runs participants that are not declared official inside a WebAssembly sandbox (Wasmtime, fuel-limited, no operating-system access). Prebuilt sandbox binaries ship for Linux (x64, arm64), macOS (x64, arm64) and Windows (x64).
- **sdk:** `defineParticipant` and `byCapability` for writing participants, and `bootTestKernel` for testing them against a real kernel.
- **daemon:** A local background host that boots kernels on request and serves them over an authenticated, encrypted local connection, with separate `ui` and `ai` caller tiers.
- **protocol:** The shared message types, method names and error codes (protocol version 1.0.0) used by the daemon and its clients.

[0.0.2]: https://github.com/rahatarch/brud/releases/tag/v0.0.2
[0.0.1]: https://github.com/rahatarch/brud/releases/tag/v0.0.1
