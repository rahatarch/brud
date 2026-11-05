# Phase 6 quarantine — `brud.patchblocks` clean cutover

Decision A2 removes the extracted implementations from `packages/core` with no
compatibility shims. The following legacy suites imported paths that no longer
exist, so they are quarantined (removed from the `test:core` glob) rather than
rewritten. Phase 11 owns their deletion or replacement.

| Quarantined test | Removed import path(s) |
|---|---|
| `packages/core/src/parser/metadata.test.ts` | `./metadata.js`, `./index.js` |
| `packages/core/src/parser/terminal.test.ts` | `./legacy.js`, `./yaml.js`, `../types/patch.js` |
| `packages/core/src/file-operations/metadata-flow.test.ts` | `../parser/index.js` |
| `packages/core/src/read-engine/read.test.ts` | `../parser/index.js` |

Coverage for the removed behaviours now lives in
`packages/plugins/brud.patchblocks/test/parity/**` and is anchored on fixtures
captured from the unmodified legacy implementation before extraction.

Type-only imports in the remaining core suites were repointed to
`@brud/patchblocks`; no assertions were changed.
