# @brud/filesystem

The Brud filesystem service and durable storage driver: robust, contained, atomic file access for BrudOS participants.

## What is `@brud/filesystem`?

`@brud/filesystem` is an official Brud Foundation participant providing durable, safe, and contained file operations on top of BrudOS. It ensures file operations stay contained within the authorized workspace boundaries, prevents symlink escapes, performs atomic multi-step writes without tearing or data loss, and protects repository-internal paths.

## Installation

```bash
npm install @brud/filesystem
```

Requires Node.js 22 or newer. `@brud/kernel` is a peer dependency.

## Key Capabilities

* **Workspace Containment**: Resolves paths against the workspace authority, rejecting traversal segments and escaping symlinks before any driver calls.
* **Atomic Mutations**: Stages writes into unique per-writer temporary files, flushes data to disk, and renames atomically to prevent split-brain states or corrupted files.
* **A10 Protected Paths**: Fail-closed protection denying modifications to internal repository metadata (`.git`), history journals, and protected workspace configuration.
* **Projections & Facades**: Supports `ReadOnlyFacade` for immutable read views and `ScopedPartitionFacade` for partitioning workspace subtrees safely.
* **Mutation Journaling**: Publishes audit descriptors (`FileMutationJournal`) with cryptographic content hashes before and after writes.

## Example

```typescript
import { createFileSystemDescriptor } from '@brud/filesystem/descriptor/descriptor.js';
import { DurableNodeStorageDriver } from '@brud/filesystem/drivers/DurableNodeStorageDriver.js';

export const filesystemDescriptor = createFileSystemDescriptor({
  driver: new DurableNodeStorageDriver(),
});
```

## Documentation

Full BrudOS platform documentation: [https://github.com/rahatarch/brud](https://github.com/rahatarch/brud)
