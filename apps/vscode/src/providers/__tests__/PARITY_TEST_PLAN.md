# Parity Test Plan — SurgicalViewProvider Refactor (Phase 2)

**Objective:** Verify that the extracted handlers (`ApplyPatchHandler`, `ExecuteCurrentFileHandler`,
`ExecuteAllFilesHandler`, `ExtractStructureHandler`, `GetStartedHandler`, `ManagementHandler`) and
services (`ErrorReporter`, `PanelManager`, `ExecutionCoordinator`, `ResultPackager`,
`TerminalDataAdapter`, `SharedExecutionHelpers`, `WorkspaceResolver`) produce identical behavior to
the god-object (`SurgicalViewProvider.ts`) before the swap.

**Status:** God-object is the active code path. New handlers are NOT wired up yet.

---

## How To Use This Document

1. For each scenario, run the god-object code path by invoking the relevant webview message or
   VS Code command manually.
2. Capture the baseline: operation results, webview messages, output channel logs, file-system
   side effects, and panel renderings.
3. After the swap, execute the same test inputs through the new handler code path.
4. Compare outputs side-by-side using the checklist at the end of each section.
5. Mark each section as PASS or FAIL.

---

## Scenario (a): Simple `create_file` (single operation)

### Input (Brud block)
````
```create_file
path: /tmp/parity-test-a.txt
content: Hello, parity test!
```
````

### Expected God-Object Behavior

| Aspect | Expected |
|---|---|
| **Command handled by** | `_handleApplyPatch` via `applyPatch` webview message |
| **Parse result** | 1 `create_file` operation |
| **Query/file split** | queryOps=[], fileOps=[1 create_file] |
| **Execution** | `executeOperationsFromVSCode` creates `/tmp/parity-test-a.txt` with content `Hello, parity test!` |
| **Webview message** | `{ command: "success", message: "Successful. Check the report at the Report Panel." }` |
| **Output channel** | `DEBUG: Before parseOperations`, `DEBUG: After parseOperations - operations count: 1`, result message |
| **Unified results panel** | Opened with the create_file operation result |
| **Side effects** | File `/tmp/parity-test-a.txt` created |

### Checklist

- [ ] Parse produces exactly 1 `create_file` operation
- [ ] QueryOps is empty
- [ ] FileOps has 1 entry
- [ ] File is created with correct content
- [ ] Webview receives `{ command: "success", ... }`
- [ ] Unified results panel is opened
- [ ] Output channel contains expected DEBUG lines

---

## Scenario (b): `search_replace` on a single file

### Precondition
Create a file at `/tmp/parity-test-b.txt` with content:
```
line one
line two
line three
```

### Input (Brud block)
````
```search_replace
path: /tmp/parity-test-b.txt
search: line two
replace: line TWO
```
````

### Expected God-Object Behavior

| Aspect | Expected |
|---|---|
| **Command handled by** | `_handlePreviewPatch` via `previewPatch` webview message, then user triggers `executeCurrentFile` or `executeAllFiles` |
| **Preview parse** | 1 `search_replace` operation |
| **Preview diff** | Diff preview panel opens showing `line two` → `line TWO` |
| **Execution** | `executeOperationsFromVSCode` replaces content in the file |
| **Side effects** | File content changed: `line two` becomes `line TWO` |

### Checklist

- [ ] Preview produces correct diff
- [ ] Diff preview panel shows the change
- [ ] Execution reports success
- [ ] File is actually modified
- [ ] Preview navigation webview messages sent (`showPreviewNavigation`, `updatePreviewHeader`)

---

## Scenario (c): Kitchen sink (18 operations of 9 kinds)

### Precondition
Ensure `/tmp/parity-kitchen/` exists and contains a file `existing.txt` with content `hello world`.

### Input (Brud block)
````
```create_file
path: /tmp/parity-kitchen/new.txt
content: new file content
```

```create_directory
directoryPath: /tmp/parity-kitchen/subdir
```

```search_replace
path: /tmp/parity-kitchen/existing.txt
search: hello world
replace: hello kitchen
```

```append_file
path: /tmp/parity-kitchen/existing.txt
position: end
content: \nappended line
```

```read_file
path: /tmp/parity-kitchen/existing.txt
```

```read_directory
directoryPath: /tmp/parity-kitchen
```

```extract_structure
directoryPath: /tmp/parity-kitchen
depth: 3
```

```codebase_metadata
root: /tmp/parity-kitchen
```

```search_files
pattern: kitchen
path: /tmp/parity-kitchen
```

```terminal_interactive
command: echo "terminal test"
```
````

*(Add enough operations to reach 18 total across these and repeated entries)*

### Expected God-Object Behavior

| Aspect | Expected |
|---|---|
| **Parse** | All operations parsed; count = 18 |
| **Query/file split** | `read_file`, `read_directory`, `extract_structure`, `codebase_metadata`, `search_files` go to queryOps; the rest go to fileOps |
| **Query execution** | `executeFileOperations` runs query ops first |
| **File execution** | `executeOperationsFromVSCode` runs file ops |
| **Unified results** | Contains extractionResults, readResults, search_results, codebase_metadata entries from query, plus file operation results |
| **Webview message** | Combined success/failure status |

### Checklist

- [ ] All 18 operations parsed correctly
- [ ] Query/file split is correct (query ops vs file ops)
- [ ] Query results appear in unified results as `extractionResults`, `readResults`, `search_files`, `codebase_metadata`
- [ ] File operations execute and produce correct results
- [ ] Combined status reflects both query and file success
- [ ] Output channel logs all DEBUG lines

---

## Scenario (d): Ordering bug (create_file + read_file)

### Input (Brud block)
````
```create_file
path: /tmp/parity-order.txt
content: created first
```

```read_file
path: /tmp/parity-order.txt
```
````

### Expected God-Object Behavior

| Aspect | Expected |
|---|---|
| **Query/file split** | queryOps=[read_file], fileOps=[create_file] |
| **Execution order** | Query ops execute FIRST (`read_file` before file is created), then file ops (`create_file`) |
| **Read result** | `read_file` FAILS because file doesn't exist yet (query ops run first) |
| **This is the KNOWN BUG** | The god-object runs query ops before file ops, so read_file cannot see the file that create_file would have made |
| **Webview message** | Partial success or error |

### Checklist

- [ ] Read_file fails with file-not-found error (god-object only — see Intentionally Divergent Behavior below)
- [ ] Create_file succeeds
- [ ] The bug is documented: queryOps execute before fileOps in god-object
- [ ] Single-pass execution INTENTIONALLY diverges here — read_file succeeds in new handler

---

## Intentionally Divergent Behavior

### Background
The god-object's `ApplyPatch` handler splits operations into `queryOps` and `fileOps`, then executes query ops **first** and file ops **second**. This two-batch approach causes three defects:

1. **Indexing misalignment**: Both query ops and file ops start at index 0, so result indices collide and do not reflect the original operation order.
2. **Ordering bug**: Query ops (read, search, extract) execute before file ops (create, write, delete), violating sequential operation semantics.
3. **Disappearing query results**: Downstream code in the god-object processes results in a way that can cause query operation outputs to be lost.

### Scenario (d) is the only divergence
| Aspect | God-object (old) | New handler (single-pass) |
|---|---|---|
| Execution model | Two-batch: queryOps then fileOps | Single-pass: operations execute in declaration order |
| `create_file` + `read_file` | `read_file` fails (query runs before file creation) | `read_file` succeeds (file exists when read executes) |
| Result indices | Reset per batch (0-based per batch) | Sequential, reflecting original operation order |
| **Status** | **Bug** | **Correct behavior** |

This is the **only scenario** where the new handler produces a different result from the god-object. All other scenarios reproduce god-object behavior exactly.

### Why this divergence is intentional
- The god-object's two-batch split is an implementation artifact, not a design decision.
- Sequential operation execution (each operation sees the side effects of prior operations) is the expected semantics.
- The upstream Brud CLI processes operations in a single pass.
- Fixing this bug during Phase 3.4 (handler extraction) is safer than deferring it, because a later behavioral change would require re-running the entire parity suite to revalidate non-divergent scenarios.

### How to verify correct behavior
1. Send the Scenario (d) block: `create_file` then `read_file` on the same path.
2. **Expected**: `read_file` succeeds and returns the file content.
3. **God-object baseline** (before swap): `read_file` fails with file-not-found.
4. **New handler** (after swap): `read_file` succeeds with content `created first`.
5. Confirm all non-(d) scenarios still match the god-object baseline.

### Checklist

- [ ] read_file succeeds with correct content in new handler
- [ ] All other scenarios (a–c, e–p) pass identically to god-object
- [ ] The divergence is documented in this section
- [ ] The divergence is intentional and reviewed

---

## Scenario (e): Unicode paths (Bengali, emoji, mixed scripts)

### Input (Brud block)
````
```create_file
path: /tmp/parity-unicode-বাংলা.txt
content: Bengali script test
```

```create_file
path: /tmp/parity-emoji-🚀.txt
content: Emoji path test
```

```create_file
path: /tmp/parity-mixed-日本語-mixed.txt
content: Mixed script test
```
````

### Expected God-Object Behavior

| Aspect | Expected |
|---|---|
| **Parse** | All three operations parsed successfully |
| **File creation** | All three files created with correct paths |
| **Unicode handling** | Paths preserved exactly (no encoding corruption) |

### Checklist

- [ ] Bengali path file created correctly
- [ ] Emoji path file created correctly
- [ ] Mixed-script path file created correctly
- [ ] All file contents are correct
- [ ] Output channel logs show correct unicode paths

---

## Scenario (f): Security escape (cd /outside → CWD_ESCAPE)

### Input (Brud block)
````
```terminal_interactive
commands:
  - cd /outside
  - ls
```
````

### Expected God-Object Behavior

| Aspect | Expected |
|---|---|
| **Parse** | 1 `terminal_interactive` operation |
| **Execution** | `executeOperationsFromVSCode` detects CWD_ESCAPE and blocks or reports the escape attempt |
| **Result** | Error: CWD_ESCAPE violation |
| **Webview message** | `{ command: "error", ... }` |
| **Side effects** | None (file system untouched) |

### Checklist

- [ ] Escape is detected and reported
- [ ] Error is sent to webview
- [ ] Unified results panel shows the error
- [ ] Output channel logs the error
- [ ] No files modified

---

## Scenario (g): Legitimate cd (cd packages && ls)

### Precondition
Directory `/tmp/parity-cd-test/` exists (create if needed).

### Input (Brud block)
````
```terminal_interactive
commands:
  - cd /tmp/parity-cd-test
  - ls
```
````

### Expected God-Object Behavior

| Aspect | Expected |
|---|---|
| **Parse** | 1 `terminal_interactive` operation |
| **Execution** | Commands execute successfully |
| **Result** | Success with `ls` output |
| **Webview message** | `{ command: "success", ... }` |
| **Side effects** | None (directory listing only) |

### Checklist

- [ ] Commands execute without CWD_ESCAPE error
- [ ] `ls` output is captured and reported
- [ ] Webview receives success message

---

## Scenario (h): Terminal command success

### Input (Brud block)
````
```terminal_interactive
command: echo "parity test ok"
```
````

### Expected God-Object Behavior

| Aspect | Expected |
|---|---|
| **Parse** | 1 `terminal_interactive` operation |
| **Execution** | Command runs successfully |
| **Result** | Exit code 0, output `parity test ok` |
| **Operation kind** | `terminal_command` |
| **Terminal data shape** | `{ command, output, exitCode: 0, duration: number, success: true }` |
| **Unified results** | Contains a `terminal_command` entry |

### Checklist

- [ ] Command executes successfully
- [ ] Output is captured correctly
- [ ] Operation result has correct shape
- [ ] Unified results includes `terminal_command` entry

---

## Scenario (i): Terminal command failure

### Input (Brud block)
````
```terminal_interactive
command: nonexistent-command-12345
```
````

### Expected God-Object Behavior

| Aspect | Expected |
|---|---|
| **Parse** | 1 `terminal_interactive` operation |
| **Execution** | Command fails (non-zero exit code) |
| **Result** | Exit code non-zero, error message captured |
| **Operation kind** | `terminal_command` |
| **Terminal data shape** | `{ command, output: error message, exitCode: non-zero, duration: number, success: false }` |
| **Webview message** | `{ command: "error", ... }` or partial success |

### Checklist

- [ ] Command fails as expected
- [ ] Error output is captured
- [ ] `success: false` in operation result
- [ ] Error is reported to user

---

## Scenario (j): Empty block (zero operations)

### Input (Brud block)
````
```
```
````

*(A completely empty Brud block produces zero operations after parsing.)*

### Expected God-Object Behavior

| Aspect | Expected |
|---|---|
| **Parse** | Zero operations |
| **Error sent** | `noValidOperationsError()` — "No valid operations found in the patch" |
| **Webview message** | `{ command: "error", message: "Failed. Check the report at the Report Panel." }` |
| **Unified results panel** | Shows error with "No valid operations found" |
| **Side effects** | None |

### Checklist

- [ ] Zero operations parsed
- [ ] Error sent to webview ("No valid operations found")
- [ ] Unified results panel shows the error
- [ ] Output channel logs the error
- [ ] No files touched

---

## Scenario (k): ApplyPatch with query ops only (extract_structure, codebase_metadata)

### Precondition
Directory `/tmp/parity-query/` exists.

### Input (Brud block)
````
```extract_structure
directoryPath: /tmp/parity-query
depth: 2
```

```codebase_metadata
root: /tmp/parity-query
```
````

### Expected God-Object Behavior

| Aspect | Expected |
|---|---|
| **Parse** | 2 operations |
| **Query/file split** | queryOps=[extract_structure, codebase_metadata], fileOps=[] |
| **Query execution** | Both execute via `executeFileOperations` |
| **File execution** | Skipped (no fileOps) |
| **Unified results** | Contains `extractionResults` and `codebase_metadata` entries |
| **Webview message** | Combined success (query success only) |

### Checklist

- [ ] Both query ops execute correctly
- [ ] No file ops executed
- [ ] Extraction results appear in unified results
- [ ] Codebase metadata appears in unified results
- [ ] Combined success reflects query result only

---

## Scenario (l): ApplyPatch with file ops only

### Input (Brud block)
````
```create_file
path: /tmp/parity-file-only.txt
content: file ops only
```

```search_replace
path: /tmp/parity-file-only.txt
search: file ops only
replace: file ops only - modified
```
````

### Expected God-Object Behavior

| Aspect | Expected |
|---|---|
| **Parse** | 2 operations |
| **Query/file split** | queryOps=[], fileOps=[create_file, search_replace] |
| **Query execution** | Skipped (no queryOps) |
| **File execution** | Both execute via `executeOperationsFromVSCode` |
| **Unified results** | Contains file operation results |
| **Webview message** | Combined success (file success only) |

### Checklist

- [ ] No query ops executed
- [ ] Both file ops execute correctly
- [ ] File is created with initial content
- [ ] Search_replace modifies the file
- [ ] Combined success reflects file result only

---

## Scenario (m): ExecuteCurrentFile from the diff preview panel

### Precondition
1. Run a `previewPatch` with at least one `search_replace` operation first (so `_fileList` is populated).
2. Then send `executeCurrentFile` via diff preview panel message.

### Input Sequence
1. (First) `previewPatch` with:
   ```` 
   ```search_replace
   path: /tmp/parity-exec-current.txt
   search: original
   replace: replaced
   ```
   ````
   (Pre-create `/tmp/parity-exec-current.txt` with content `original`.)

2. (Second) `{ command: "executeCurrentFile", fileIndex: 0 }` sent from diff preview panel webview.

### Expected God-Object Behavior

| Aspect | Expected |
|---|---|
| **Step 1: previewPatch** | Diff preview panel opens, `_fileList` populated, `_currentFileIndex = 0` |
| **Step 2: executeCurrentFile** | `_handleExecuteCurrentFile(0)` → executes operations for file at index 0 |
| **DiffPreviewPanelManager message** | Receives `executeCurrentFile` from `_handleDiffPreviewPanelMessage` |
| **Execution** | `executeOperationsFromVSCode` with file's operations |
| **Diff preview message** | `{ command: "filePatched", fileIndex: 0 }` sent |
| **Preview tabs closed** | Yes |
| **Unified results** | Opened with results |

### Checklist

- [ ] Preview populates file list correctly
- [ ] executeCurrentFile dispatches correct file's operations
- [ ] filePatched message sent to diff preview panel
- [ ] Preview tabs closed
- [ ] Unified results show execution outcome

---

## Scenario (n): ExecuteAllFiles from the diff preview panel

### Precondition
Same as scenario (m) — preview populated with multiple operations.

### Input
Diff preview panel sends `{ command: "executeAllFiles" }`.

### Expected God-Object Behavior

| Aspect | Expected |
|---|---|
| **Handler** | `_handleDiffPreviewPanelMessage` dispatches to `_handleExecuteAllFiles` |
| **Execution** | All operations from all files executed |
| **State cleanup** | `_fileList` cleared, `_operationsByFile` cleared, `_currentFileIndex` reset to 0, `_diffPreviewSessionId` cleared |
| **Diff preview message** | `{ command: "executeSuccess", message: "Successfully applied N patches" }` |
| **Preview tabs** | Closed |
| **Webview message** | `{ command: "hidePreviewNavigation" }` sent |

### Checklist

- [ ] All operations executed
- [ ] State is fully cleared after success
- [ ] executeSuccess message sent to diff preview panel
- [ ] hidePreviewNavigation sent to sidebar webview
- [ ] Preview tabs closed

---

## Scenario (o): Extract structure via the extract button

### Input
Webview sends `{ command: "extractStructure", text: "..." }` with:
````
```extract_structure
directoryPath: /tmp/parity-extract
depth: 2
```
````
(Pre-create `/tmp/parity-extract/` with some files.)

### Expected God-Object Behavior

| Aspect | Expected |
|---|---|
| **Handler** | `_handleExtractStructure` |
| **Parse** | 1 `extract_structure` operation |
| **Filter** | Only `extract_structure` ops kept |
| **Execution** | `executeFileOperations` with extract ops |
| **Success result** | Parsed JSON → `StructureResult[]` |
| **Webview message** | `{ command: "success", message: "Successful. Check the report at the Report Panel." }` |
| **Unified results** | Opened with `extractionResults` entries |
| **Output channel** | `Extracted directory structures: /tmp/parity-extract (depth 2)` |

### Checklist

- [ ] Parse produces correct operations
- [ ] Only extract_structure ops are executed
- [ ] Structure results parsed correctly (directoryPath, depth, fileCount, directoryCount)
- [ ] Webview receives success message
- [ ] Unified results panel shows the structure
- [ ] Output channel logs the extraction

---

## Scenario (p): openManagement / openGetStarted commands

### Input (webview message or command)
- `{ command: "openMainWindow" }` or `{ command: "openPromptLibrary" }` → `vscode.commands.executeCommand('brud.openManagement')`
- `{ command: "openGetStarted" }` → `vscode.commands.executeCommand('brud.getStarted')`
- `{ command: "openUnifiedResults" }` → Opens unified results panel with `_lastExecutionResult`

### Expected God-Object Behavior

| Aspect | Expected |
|---|---|
| **openMainWindow handler** | `vscode.commands.executeCommand('brud.openManagement')` |
| **openPromptLibrary handler** | `vscode.commands.executeCommand('brud.openManagement')` |
| **openGetStarted handler** | `vscode.commands.executeCommand('brud.getStarted')` |
| **openUnifiedResults handler** | Opens unified results panel with `_lastExecutionResult` |
| **Side effects** | None (commands dispatched, panels revealed) |

### Checklist

- [ ] openMainWindow triggers `brud.openManagement`
- [ ] openPromptLibrary triggers `brud.openManagement`
- [ ] openGetStarted triggers `brud.getStarted`
- [ ] openUnifiedResults shows last execution result
- [ ] All commands fire-and-forget (no await needed)

---

## Handler-to-God-Object Mapping

| Webview Message | God-Object Method | New Handler |
|---|---|---|
| `applyPatch` | `_handleApplyPatch` | `ApplyPatchHandler.handle()` |
| `previewPatch` | `_handlePreviewPatch` | N/A (remains in SurgicalViewProvider) |
| `previewNextFile` | `_handlePreviewNextFile` | N/A (remains) |
| `previewPrevFile` | `_handlePreviewPrevFile` | N/A (remains) |
| `previewAllFiles` | `_handlePreviewAllFiles` | N/A (remains) |
| `executeCurrentFile` | `_handleExecuteCurrentFile` | `ExecuteCurrentFileHandler.handle()` |
| `executeAllFiles` | `_handleExecuteAllFiles` | `ExecuteAllFilesHandler.handle()` |
| `rejectPreview` | `_handleRejectPreview` | N/A (remains) |
| `extractStructure` | `_handleExtractStructure` | `ExtractStructureHandler.handle()` |
| `openMainWindow` | inline → `brud.openManagement` | `ManagementHandler.handle()` |
| `openPromptLibrary` | inline → `brud.openManagement` | `ManagementHandler.handle()` |
| `openGetStarted` | inline → `brud.getStarted` | `GetStartedHandler.handle()` |
| `openUnifiedResults` | inline panel.open | `PanelManager.showUnifiedResults()` |

**Note:** `previewPatch`, `previewNextFile`, `previewPrevFile`, `previewAllFiles`, and
`rejectPreview` remain in `SurgicalViewProvider` and are NOT extracted into handlers.

---

## Service Coverage

| Service | Methods | Used By |
|---|---|---|
| `ErrorReporter` | `sendError`, `sendParseError`, `generateErrorReport` | `ApplyPatchHandler`, `ExtractStructureHandler` |
| `PanelManager` | `showUnifiedResults`, `showDiffPreview`, `showNoPreview`, `postDiffPreviewMessage`, `closeDiffPreview` | All handlers |
| `ExecutionCoordinator` | `execute` | `ExecuteCurrentFileHandler`, `ExecuteAllFilesHandler` |
| `ResultPackager` | `packageOperationResults`, `extractStructuredData` | Future wiring |
| `TerminalDataAdapter` | `transformTerminalOperation`, `buildFailedTerminalData` | `ResultPackager`, `SharedExecutionHelpers` |
| `SharedExecutionHelpers` | `getChatStatusMessage`, `reportExecutionResult`, `transformTerminalOperationData`, `closePreviewTabs` | `ApplyPatchHandler`, `ExecuteCurrentFileHandler`, `ExecuteAllFilesHandler` |
| `WorkspaceResolver` | `getRoot`, `hasWorkspace`, `getAll` | `ExecutionCoordinator` |

---

## Diff Analysis: God-Object vs New Handlers

### ApplyPatchHandler differences
- **LastExecutionResult**: God-object stores on instance `_lastExecutionResult`; new handler uses getter/setter delegates.
- **Error handling**: God-object calls `_sendErrorToWebview` and `_sendParseErrorToWebview` directly; new handler uses `ErrorReporter`.
- **Terminal data**: God-object builds failed terminal data inline; new handler uses `buildFailedTerminalData` from `TerminalDataAdapter`.
- **Terminal transform**: God-object uses `_toTerminalOperationData`; new handler uses `transformTerminalOperationData` from `SharedExecutionHelpers` (which delegates to `transformTerminalOperation` in `TerminalDataAdapter`).

### ExecuteCurrentFileHandler differences
- God-object accesses `_fileList`, `_currentFileIndex`, `_operationsByFile` directly; new handler uses getter delegates.
- God-object calls `_reportExecutionResult`; new handler calls `reportExecutionResult` from `SharedExecutionHelpers`.
- God-object calls `_toTerminalOperationData`; new handler calls `transformTerminalOperationData`.

### ExecuteAllFilesHandler differences
- God-object clears state directly (`this._fileList = []`, etc.); new handler uses `clearFileList()`, `clearOperationsByFile()`, `resetCurrentFileIndex()` delegates.
- Same structural differences as ExecuteCurrentFileHandler.

### ExtractStructureHandler differences
- God-object calls `_sendErrorToWebview` and `_sendParseErrorToWebview`; new handler uses `ErrorReporter`.
- God-object opens panel via `this._unifiedResultsPanelManager?.openUnifiedResultsPanel(...)`; new handler uses `this.panelManager.showUnifiedResults(...)`.

---

## Manual Test Procedure

For each scenario:

1. **Prepare**: Set up any preconditions (files, directories).
2. **Clear state**: Close all preview panels, clear output channel.
3. **Execute**: Paste the Brud block into the sidebar webview and click the appropriate button
   (Apply Patch, Preview, Extract Structure, etc.).
4. **Capture**: Screenshot or log:
   - Output channel contents
   - Webview messages (use DevTools on the webview)
   - File-system state (file existence, content)
   - Panel rendering (diff preview, unified results)
5. **Record**: Fill in the checklist for each scenario.
6. **Repeat after swap**: After wiring in the new handlers, execute the exact same input and
   compare all captured outputs.

---

## Overall Comparison Checklist

- [ ] All 16 scenarios pass with god-object
- [ ] All 16 scenarios pass with new handlers
- [ ] Every webview message shape matches
- [ ] Every output channel log matches
- [ ] Every file-system side effect matches
- [ ] Every error case produces identical error text and panel behavior
- [ ] Unicode paths are handled identically
- [ ] Empty/no-op inputs produce identical error responses
- [ ] Terminal command success/failure produce identical result shapes
- [ ] State cleanup (fileList, operationsByFile, currentIndex, sessionId) is identical