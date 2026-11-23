# filesystem 0.0.1

## Summary
The initial release of `@brud/filesystem`, the official Brud Foundation filesystem participant for BrudOS. It provides atomic file writes, workspace containment, symlink escape prevention, immutable and partition facades, and cryptographic mutation journaling for compositions.

## Changes
### Added
- **filesystem:** Contained filesystem operations with strict workspace root enforcement, rejecting traversal sequences and escaping symlinks before reaching the driver.
- **filesystem:** Atomic file staging with fsync durability and rename isolation to prevent split-brain states and corrupted writes across concurrent processes.
- **filesystem:** A10 protected-path denylist denying modifications to repository internals (`.git`), history stores, and sensitive workspace configuration.
- **filesystem:** `ReadOnlyFacade` for serving immutable directory projections, and `ScopedPartitionFacade` for isolated subdirectory sandboxing.
- **filesystem:** `FileMutationJournal` emitting pre- and post-write audit events with SHA-256 content hashes.
- **filesystem:** `DurableNodeStorageDriver` providing crash-resilient file I/O over the host filesystem.
