# Testing

## Existing Test Coverage

### `terminal.test.ts`

Located at `packages/core/src/validation/terminal.test.ts`.

- **Dangerous Commands**: 13 test cases covering `rm -rf /`, `rm -rf ~`, `rm -rf .`, `rm -fr /`, `sudo`, `rm -rf /*`, `curl | bash`, `wget | sh`, `chmod -R 777`, `dd`, `mkfs`, `fdisk`, and safe commands (`npm install`, `rm -rf ./safe/path`).
- **validateTerminalCwd**: 5 test cases covering cwd inside workspace, outside workspace, undefined cwd, empty cwd, and empty workspace folders.

### Read Engine Tests (`read.test.ts`)

Located at `packages/core/src/read-engine/read.test.ts`.

- Tests 8 and 9 cover `validateWorkspacePath` — resolving relative paths and rejecting paths outside the workspace.
- Test 10 exercises the full READ_FILE flow through parser and engine, which validates paths via the API.

## What Is NOT Currently Tested

| Area | Missing Coverage |
|------|-----------------|
| `BrudAPI.validate.workspace()` | No direct tests; only indirectly tested via cwd |
| `BrudAPI.validate.path()` | No direct unit tests; exercised via `validateWorkspacePath` wrapper |
| `BrudAPI.validate.command()` | Tested indirectly through `isDangerousCommand` wrapper |
| `BrudAPI.validate.cwd()` | Tested indirectly through `validateTerminalCwd` wrapper |
| `BrudAPI.validate.fileExists()` | No tests |
| `BrudAPI.validate.directoryExists()` | No tests |
| `BrudAPI.validate.fileNotExists()` | No tests |
| `BrudAPI.validate.directoryNotExists()` | No tests |
| `BrudAPI.validate.searchText()` | No tests |
| `BrudAPI.validate.singleMatch()` | No tests |
| `BrudAPI.validate.canOpenFile()` | No tests |
| `BrudAPI.validate.canDelete()` | No tests |
| `BrudAPI.validate.canRevert()` | No tests |
| `BrudAPI.validate.sessionExists()` | No tests |
| `BrudAPI.validate.validPosition()` | No tests |
| `BrudAPI.validate.validMode()` | No tests |
| `BrudAPI.validate.knownOperation()` | No tests |
| `BrudAPI.validate.knownTool()` | No tests |
| `BrudAPI.validate.validFormat()` | No tests |
| `BrudAPI.validate.terminalAvailable()` | No tests |
| `BrudAPI.validate.validRevertRequest()` | No tests |
| `BrudAPI.validate.validCommandOrCommands()` | No tests |
| `BrudAPI.validate.validAnswers()` | No tests |
| `BrudAPI.validate.hasPatterns()` | No tests |
| `BrudAPI.validate.requiredField()` | No tests |
| `BrudAPI.validate.hasIndex()` | No tests |
| `BrudAPI.validate.hasPreview()` | No tests |
| `BrudAPI.validate.hasValidOperations()` | No tests |
| `BrudAPI.validate.canGeneratePreview()` | No tests |
| `BrudAPI.validate.hasExtractOperations()` | No tests |
| Error factories | No direct unit tests for any factory function |

## How to Run Validation Tests

```bash
# From the packages/core directory:
cd packages/core

# Run the terminal validation tests only
npx node --test src/validation/terminal.test.ts

# Run all core tests
npx node --test src/**/*.test.ts

# From the project root (if configured):
npm test
```

## How to Write New Validation Tests

The test suite uses Node's built-in `node:test` and `node:assert` modules. Test files follow the `.test.ts` naming convention.

Basic test structure:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { BrudAPI } from '../api/index.js';

describe('BrudAPI.validate.validPosition', () => {
  it('accepts "start" and "end"', () => {
    assert.strictEqual(BrudAPI.validate.validPosition('start').success, true);
    assert.strictEqual(BrudAPI.validate.validPosition('end').success, true);
  });

  it('rejects invalid positions', () => {
    const result = BrudAPI.validate.validPosition('middle');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'INVALID_FIELD');
  });
});
```

For async filesystem tests, use the `NodeFileSystem` helper:

```typescript
import { NodeFileSystem } from '../testing/nodeFileSystem.js';

describe('BrudAPI.validate.fileExists', () => {
  it('returns FILE_NOT_FOUND for missing file', async () => {
    const fs = new NodeFileSystem();
    const result = await BrudAPI.validate.fileExists(fs, '/tmp/nonexistent.txt');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'FILE_NOT_FOUND');
  });
});
```