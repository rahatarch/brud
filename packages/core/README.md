# @brud/core

Platform-agnostic core engine for Brud Code. Provides file operations, surgical text matching, history/snapshot/revert, terminal execution, parsing, search, prompt library, and validation — with zero VS Code dependencies.

## Purpose

The single source of truth for Brud's logic. Every operation type, every validation rule, every history snapshot, every terminal command — they all live here as pure TypeScript. Platform adapters implement the `FileSystem` and `HistoryStore` interfaces; the core never touches the filesystem or terminal directly.

## Installation

```bash
npm install @brud/core
```

## Key Public API

| Area | Key Exports |
|------|-------------|
| **Operations** | `parseOperations()`, `executeFileOperations()`, `FileOperation` |
| **Engine** | `findMatches()`, `reconstructContent()` |
| **History** | `recordSession()`, `createSnapshot()`, `revertSession()`, `HistoryStore` |
| **Validation** | `BrudAPI.validate.*`, `BrudError` |
| **Terminal** | `executeTerminalCommand()`, `executeSequential()`, `TerminalExecutor` |
| **File System** | `FileSystem` (11-method interface) |
| **Search** | `searchFiles()`, `matchGlob()`, `isGlobPattern()` |
| **Prompt Library** | `getPromptById()`, `getAllPrompts()` |
| **Cleaner** | `cleanBrudInput()` |
| **Utilities** | `validateWorkspacePath()`, `createPathResolver()` |

## Child Modules

| Module | Purpose |
|--------|---------|
| `api/` | Central validation, error factories, `BrudError` class |
| `cleaner/` | Input cleaning (strip wrapper tags) |
| `engine/` | Surgical pattern matching + content reconstruction |
| `file-operations/` | Orchestrates all 20 operation types |
| `history/` | Sessions, snapshots, reverts, soft-delete, retention |
| `import-resolver/` | Multi-language import resolution |
| `metadata-extractor/` | Codebase scale analysis |
| `parser/` | Legacy + YAML Brud block parsing |
| `prompt-library/` | AI system prompts + per-operation prompts |
| `read-engine/` | File reading with import following |
| `search/` | Glob-based file search |
| `structure-extractor/` | Token-efficient directory structure maps |
| `terminal/` | Platform-agnostic terminal execution |
| `testing/` | Test utilities (NodeFileSystem, TestHistoryStore) |
| `tool-registry/` | Tool documentation registry (20 tools) |
| `types/` | `FileSystem` interface + all operation types |
| `utils/` | Workspace path validation + path resolution |
| `validation/` | Terminal command safety checks |

## How It's Used

Consumers implement the abstractions:

```typescript
// 1. Implement FileSystem for your platform
class MyFileSystem implements FileSystem { /* ... */ }

// 2. Implement HistoryStore for persistence
class MyHistoryStore implements HistoryStore { /* ... */ }

// 3. Parse and execute
const operations = parseOperations(brudBlockText, workspaceFolders);
const result = await executeFileOperations(operations, myFileSystem, myHistoryStore);
```

Reference implementation: `packages/adapters/vscode/` — VS Code `FileSystem` and `WorkspaceHistoryStore`.

## Testing

Tests use real filesystem operations with temp directories — no mocking of I/O.

```bash
npm run test:core
```

Test utilities in `src/testing/`:
- `NodeFileSystem` — real FS adapter
- `TestHistoryStore` — in-memory history for tests
- `createTestWorkspace()` / `cleanupTestWorkspace()` — temp workspace setup

## Deeper Documentation

Public documentation for complex modules lives in `docs/public/`:

- `validation-api.md` — BrudAPI validation: what it validates, how to call it, how to test it, how to extend it
- `history-system.md` — sessions, snapshots, reverts, soft-delete, retention
- `file-operations.md` — the 20 operation types and execution flow
- `parser.md` — legacy and YAML Brud block formats

(These docs are being written. Links will be updated as they're created.)

## Dependencies

- `diff` — unified diffs for snapshots and reverts
- `js-yaml` — YAML Brud block parsing