# Session & Operation Metadata System

## 1. Overview

The Session and Operation Metadata feature introduces optional, user-supplied labels to Brud Block syntax. These labels let developers attach a human-readable title and description to an entire session or to individual operations within it. This addresses a growing need in Brud Code: as sessions become more complex and the history panel fills with dozens of entries, users and AI agents both struggle to quickly identify what a particular session did or why a specific operation was performed.

The metadata system is strictly additive. Every existing session, parser path, storage schema, and UI component continues to function exactly as before. The new `parseOperationsWithMetadata` function returns the same operation data that `parseOperations` returns today, augmented with optional title and description fields at the session and operation levels. Existing callers that never migrate to the metadata-aware path see no difference in behavior.

This feature unlocks several downstream capabilities. Session titles display in the History panel where session IDs currently appear alone, making the list instantly scannable. Operation titles render in the operation list inside the Session Detail view, giving each operation a purpose label alongside its type and file path. The Copy Summary feature can include titles and descriptions when they are present. And the AI master prompt gains structured guidance that teaches the model when and how to attach metadata to the blocks it generates.

The scope of this design covers syntax specification, parser changes, data model extensions at every layer from parser to on-disk storage, validation and error handling, UI integration in all affected panels, master prompt updates, and exhaustive edge-case treatment. It does not cover metadata-aware filtering, search, or grouping of history entries; those are left as future extensions.

## 2. Syntax Specification

### 2.1 Legacy Format (Block Wrappers)

In the legacy Brud Block format, metadata is expressed using dedicated wrapper tokens that follow the same convention as `<BRUD_INSTRUCTIONS>`.

The `<session_metadata>` wrapper must appear as the very first element after `<BRUD_INSTRUCTIONS>`, before any operation block. It opens with `<session_metadata>` on its own line and closes with `</session_metadata>` on its own line. Inside, the content is freeform text that the parser interprets as key-value lines. The only recognized field names are `title:` and `description:`, both in strict lowercase. A `title:` line provides the session title. A `description:` line provides the session description. If a description spans multiple lines, each continuation line must be indented by at least one space. No indentation is required for the first value line. The parser reads all indented lines that follow a field name as part of that field's value, stopping when it encounters a non-indented line or the closing wrapper.

The `<operation_metadata>` wrapper appears inside an individual operation block. It must be placed immediately after the operation header line — the line that identifies the operation type — and before the content separator (the `=======` line). The same field rules apply: `title:` and `description:` are the only recognized field names, both strict lowercase, both optional. Multiline values follow the same indented-continuation rule.

Both wrapper tokens are strict lowercase. An opening tag of `<Session_Metadata>` or `<SESSION_METADATA>` is rejected with a specific error. Closing tags must match the opening tag exactly: `</session_metadata>` for a session metadata block and `</operation_metadata>` for an operation metadata block. Mismatched case in either the opening or closing tag produces a validation error.

Only one session metadata block is permitted per Brud Block document. Only one operation metadata block is permitted per operation. If the parser encounters a second session metadata block at the session level or a second operation metadata block inside the same operation, it raises a duplicate-metadata error.

### 2.2 YAML Format (Nested Wrapper Keys)

In the YAML Brud Block format, metadata is expressed through the same nesting conventions that YAML already uses for operations. The YAML parser recognizes two special keys: `session_metadata:` and `operation_metadata:`. These keys are strict lowercase. A key of `Session_Metadata:` or `SESSION_METADATA:` is rejected.

The `session_metadata:` key appears at the top level of the YAML document, alongside the `operations:` key. Its value is a mapping that may contain the keys `title:` and `description:`. Both are optional. Multiline values in YAML use YAML's native block scalar syntax — a pipe character followed by indented lines.

The `operation_metadata:` key appears inside an individual operation entry in the YAML `operations:` array. It is a sibling of keys like `type:` and `content:`. Its value is a mapping that may contain `title:` and `description:`. Only one `operation_metadata:` block is permitted per operation entry. A duplicate produces a validation error.

### 2.3 Case Strictness

Case sensitivity is enforced at every level. The wrapper tokens, the YAML keys, and the field names all require exact lowercase. The rationale is consistency with the existing `<BRUD_INSTRUCTIONS>` token, which is uppercase by design. The metadata tokens are deliberately lowercase to create a visual and syntactic distinction from the session-level instruction wrapper. The parser must not normalize or case-fold any of these tokens; it must compare the raw text.

### 2.4 Multiline Value Rules

A multiline value in legacy format begins on the same line as the field name, after the colon and a space, or on the very next line if the field name line ends with nothing after the colon. In either case, continuation lines must be indented by at least one space. The indentation requirement is minimal — any whitespace character counts. The parser accumulates indented lines as part of the value until it encounters a line that starts with a non-whitespace character at column zero. That line either begins a new field or signals the end of the metadata block.

In YAML format, multiline values use YAML's native pipe (`|`) or folded (`>`) block scalar indicators. The parser relies on the standard YAML deserialization library to handle these.

### 2.5 Position Rules

Session metadata must appear immediately after `<BRUD_INSTRUCTIONS>` and before any operation block. No content of any kind — not even a blank line — is permitted between the closing `</BRUD_INSTRUCTIONS>` tag and the opening `<session_metadata>` tag, nor between `</session_metadata>` and the first operation. If content appears between `<BRUD_INSTRUCTIONS>` and `<session_metadata>`, the parser treats it as unrecognized content and raises an error. If content appears between `</session_metadata>` and the first operation, the parser raises an out-of-position error.

Operation metadata must appear inside an operation block, after the operation header line and before the `=======` content separator. If operation metadata appears after the separator, the parser treats it as part of the operation content, which may or may not cause a downstream error but will not be recognized as metadata.

### 2.6 After Upstream Stripping

By the time the metadata parser runs, the upstream processing has already stripped the `<BRUD_INSTRUCTIONS>` wrapper and its contents. The parser receives the remainder of the block document. In the legacy format, this remainder begins with either a `<session_metadata>` tag or an operation header. In YAML format, it begins with the top-level YAML mapping that may contain a `session_metadata:` key.

## 3. Data Model

### 3.1 Session Metadata Type

Session metadata is a simple data structure with two optional string fields: `title` and `description`. When either field is absent, the parser returns undefined for that field. Neither field defaults to an empty string; absent and empty are distinct states.

### 3.2 Operation Metadata Type

Operation metadata is identical in shape: two optional string fields, `title` and `description`, both of which may be undefined when absent.

### 3.3 Type Propagation through Layers

The metadata flows through every layer of the system. The following describes each layer transition and what changes.

**Parser input to parsed operations.** The new `parseOperationsWithMetadata` function returns a structure that contains the same array of parsed operations that `parseOperations` returns, plus a `sessionMetadata` field at the top level. Each parsed operation object gains an optional `metadata` field containing the operation's title and description.

**Parsed operations to FileOperation objects.** When the engine builds `FileOperation` objects from parsed operations, it copies the optional `metadata` field from the parsed operation into the `FileOperation`. The `FileOperation` interface gains an optional `metadata` field of the operation metadata type.

**FileOperation to OperationResult.** The execution engine produces an `OperationResult` for each `FileOperation` it executes. The `OperationResult` already carries fields like `operationId`, `type`, `status`, and `filePath`. It gains an optional `metadata` field that mirrors the `FileOperation`'s metadata field.

**OperationResult to HistorySession.** When the History module records a session, it assembles a `HistorySession` object that contains an `operations` array of `OperationResult` objects with their metadata fields. The `HistorySession` itself gains an optional `sessionMetadata` field at the top level, populated from the session metadata returned by `parseOperationsWithMetadata`.

**HistorySession to session.json.** The `HistorySession` object is serialized directly to `session.json`. The optional fields serialize naturally. When they are absent, the JSON simply omits the keys. When they are present, the JSON includes the keys with their string values.

### 3.4 Every Type That Needs New Optional Fields

The following types receive new optional fields. Each field is marked as optional (the question mark convention) in the type system, and the serialization layer ensures that undefined fields are omitted from JSON output.

At the parser output level, the return type of `parseOperationsWithMetadata` includes a `sessionMetadata` field of the session metadata shape, and each item in the `operations` array includes an optional `metadata` field of the operation metadata shape.

At the engine level, the `FileOperation` type gains an optional `metadata` field. The `OperationResult` type gains an optional `metadata` field.

At the history level, the `HistorySession` type gains an optional `sessionMetadata` field. The `OperationResult` type within the history module's scope already carries operation-level data; it gains the `metadata` field if not already present through the shared type.

At the UI level, the rendering components that display session details and operation details gain props for optional title and description, with appropriate fallback rendering when those props are undefined.

### 3.5 Field Names and Optionality

Every new field is optional at every layer. No field is required at any layer. This is the central backward-compatibility guarantee: existing code paths that never touch metadata fields see no change in behavior, and existing on-disk session files load correctly with undefined metadata fields.

At the session level: `sessionMetadata.title` and `sessionMetadata.description`.

At the operation level: `metadata.title` and `metadata.description`.

## 4. Parser Design

### 4.1 Where the Pre-Pass Runs

The metadata extraction runs as a pre-pass before the main parser logic. In the legacy format, the parser scans the document for `<session_metadata>` and `<operation_metadata>` wrappers, extracts their content, then strips them from the document before handing the cleaned document to the existing `parseOperations` pipeline. In the YAML format, the parser checks for the `session_metadata:` top-level key and the `operation_metadata:` keys within operations before passing the remaining YAML structure to the existing YAML parse pipeline.

### 4.2 Legacy Parser: Wrapper Extraction

The legacy parser's metadata pre-pass works as a state machine with a small number of states. It reads the document line by line.

For session metadata, the pre-pass looks for a `<session_metadata>` line at the very start of the document (after upstream stripping of `<BRUD_INSTRUCTIONS>`). If found, it enters a reading state, accumulating lines until `</session_metadata>` is encountered. The accumulated lines are then parsed as key-value pairs. The wrapper lines and their content are removed from the document, and the remaining document text is passed to the existing `parseOperations` function.

For operation metadata, the pre-pass scans the document for `=======` separators that delineate operation blocks. Within each block, it looks for an `<operation_metadata>` line between the operation header and the separator. If found, it reads until `</operation_metadata>`, extracts the content, removes the wrapper and its content from the operation block, and attaches the parsed metadata to the operation by its index in the array.

The pre-pass must handle the case where session metadata is absent: it simply skips the session metadata extraction step. It must also handle the case where a given operation has no operation metadata: it skips that operation's metadata extraction. In both cases, the metadata field is left as undefined.

### 4.3 YAML Parser: Wrapper Extraction

The YAML parser's metadata extraction is simpler because YAML's structure already provides key-based access. After deserializing the YAML document, the parser checks for a `session_metadata` key at the top level. If present, it reads the `title` and `description` subkeys. The `session_metadata` key is then removed from the parsed object before passing it to the existing YAML operation parser. Similarly, for each operation in the `operations` array, the parser checks for an `operation_metadata` key, reads the subkeys, removes the key, and proceeds with the existing parse logic.

### 4.4 Attaching Metadata to Operations by Index

Both parsers produce an array of parsed operations. The metadata pre-pass produces a parallel array of optional metadata objects, aligned by index. After the main parser produces the operations array, the metadata pre-pass iterates over the operations and assigns the metadata to each operation by index. If a particular index has no metadata, the operation's metadata field remains undefined.

This index-based approach works because the pre-pass and the main parser see the same document — the pre-pass has removed the metadata wrappers, so the main parser sees the same operations in the same order that the pre-pass enumerated.

### 4.5 Session Metadata Return

The session metadata is returned alongside the operations array. The return type of `parseOperationsWithMetadata` is a structure with two fields: `sessionMetadata` (the session metadata object, or undefined if no session metadata was present) and `operations` (the array of parsed operations, each with an optional `metadata` field).

### 4.6 The New Return Type

The return type contains a `sessionMetadata` property that is either a session metadata object with `title` and `description` fields, or undefined. It contains an `operations` property that is an array of parsed operation objects, each of which may have a `metadata` property that is either an operation metadata object or undefined.

### 4.7 Backward Compatibility

The existing `parseOperations` function remains completely untouched. It is called internally by `parseOperationsWithMetadata` after the pre-pass strips the metadata wrappers. Callers that use `parseOperations` see no metadata — the metadata only exists in the output of `parseOperationsWithMetadata`. This ensures that every existing code path that calls `parseOperations` continues to work identically.

### 4.8 Shared Metadata Extraction Logic

The two parsers share a common metadata parsing utility. This utility takes a string of key-value lines and returns an object with optional `title` and `description` fields. It handles the line-by-line parsing, indentation detection for multiline values, field name validation, and duplicate field detection. Both the legacy pre-pass and the YAML post-deserialization step call this utility. The utility is stateless and pure — it accepts a string and returns a metadata object. This design ensures that the metadata parsing behavior is identical regardless of which format the user wrote.

## 5. Validation and Error Handling

### 5.1 Validation Rules

Every validation rule produces a specific error code and a human-readable message. The following table lists each rule, the condition that triggers it, the error code, and the message template.

**Wrapper token has incorrect case.** When a `<session_metadata>` or `<operation_metadata>` opening or closing tag uses mixed or uppercase characters, the parser raises error code `E_METADATA_WRONG_CASE` with the message "Metadata wrapper '<token>' must be lowercase. Found '<actual>'."

**Duplicate session metadata.** When a second `<session_metadata>` block appears at the session level, the parser raises error code `E_DUPLICATE_SESSION_METADATA` with the message "Duplicate session metadata block. Only one <session_metadata> block is allowed."

**Duplicate operation metadata.** When a second `<operation_metadata>` block appears inside the same operation, the parser raises error code `E_DUPLICATE_OPERATION_METADATA` with the message "Duplicate operation metadata block in operation '<index>'. Only one <operation_metadata> block is allowed per operation."

**Session metadata out of position.** When `<session_metadata>` does not appear immediately after `<BRUD_INSTRUCTIONS>` — that is, when there is content between the closing instruction tag and the metadata opening tag — the parser raises error code `E_SESSION_METADATA_POSITION` with the message "Session metadata must be the first element after <BRUD_INSTRUCTIONS>."

**Operation metadata out of position.** When `<operation_metadata>` does not appear before the `=======` separator in its operation block, the parser raises error code `E_OPERATION_METADATA_POSITION` with the message "Operation metadata must appear before the content separator in operation '<index>'."

**Unrecognized field name.** When a line inside a metadata block starts with a word that is not `title:` or `description:`, the parser raises error code `E_METADATA_UNKNOWN_FIELD` with the message "Unknown metadata field '<field>'. Only 'title:' and 'description:' are allowed."

**Field name wrong case.** When a field name uses mixed or uppercase characters, such as `Title:` or `DESCRIPTION:`, the parser raises error code `E_METADATA_FIELD_CASE` with the message "Metadata field '<field>' must be lowercase. Did you mean '<lowercase>'?"

**Unclosed wrapper.** When a `<session_metadata>` or `<operation_metadata>` opening tag is found without a corresponding closing tag before the end of the document or the end of the operation block, the parser raises error code `E_METADATA_UNCLOSED` with the message "Unclosed <token> wrapper. Expected </token>."

**Unexpected content in metadata block.** When a line inside a metadata block does not match the key-value pattern and is not indented as a continuation line, the parser raises error code `E_METADATA_INVALID_CONTENT` with the message "Invalid content in metadata block: '<line>'."

### 5.2 Error Propagation

All metadata validation errors are collected during the pre-pass phase. The pre-pass does not halt on the first error; it collects all errors and returns them alongside the parsed metadata. The `parseOperationsWithMetadata` function checks for errors after the pre-pass. If any errors are found, it throws a composite error containing the list of individual validation failures. The caller catches this error and displays the messages to the user through the standard Brud Code validation error display mechanism.

The YAML format parser performs validation after deserialization. It checks the structure of the parsed YAML for the metadata keys. If a key like `Session_Metadata:` is found instead of `session_metadata:`, the YAML parser normalizes the key detection to catch case violations early.

### 5.3 Error Display

Validation errors appear in the same location where other Brud Block validation errors are displayed: the error panel or inline decoration in the editor. Each error includes the error code for reference and the human-readable message. The messages are designed to be actionable — they tell the user exactly what is wrong and how to fix it.

## 6. Storage Design

### 6.1 session.json Schema Additions

The `session.json` file gains an optional top-level field called `sessionMetadata`. When present, it is an object with two optional string fields: `title` and `description`. The existing `operations` array objects gain an optional `metadata` field, also an object with two optional string fields.

### 6.2 OperationResult Schema Additions

The `OperationResult` type, which is stored as part of the session's operations array, gains an optional `metadata` field. This field is populated from the `FileOperation`'s metadata during execution recording. If the `FileOperation` had no metadata, the `OperationResult`'s metadata field is undefined.

### 6.3 Backward Compatibility

Existing session files contain no `sessionMetadata` or operation-level `metadata` fields. When the History module loads a session file, it deserializes the JSON into a `HistorySession` object. If `sessionMetadata` is absent, the field defaults to undefined. If operation-level `metadata` is absent, each operation's metadata field defaults to undefined. No migration is needed because the new fields are optional and absent keys naturally produce undefined values in the deserialized object.

### 6.4 No Migration Required

The storage format change is purely additive. Old session files contain no metadata keys, and the code that reads them handles missing keys gracefully. New session files written by the updated code include metadata keys only when metadata was present in the parsed block. This means no migration script, no schema version bump, and no backward-compatibility layer are required.

### 6.5 Legacy Sessions Loaded by New Code

When a legacy session file is loaded by the updated version of Brud Code, the `sessionMetadata` field in the resulting `HistorySession` object is undefined. The UI components that display session title check for undefined and fall back to showing the session ID. Operation titles in legacy sessions are similarly undefined, and the UI falls back to showing the operation type and file path as it does today.

### 6.6 New Sessions Loaded by Older Versions

When a session file containing metadata is loaded by an older version of Brud Code that does not know about the metadata fields, the older version's deserializer simply ignores the unknown keys. The `sessionMetadata` field is not part of the older type definition, so it is discarded during deserialization or silently ignored. This is the standard forward-compatibility behavior of JSON deserialization in TypeScript. The session still loads, the operations still render, and the older version experiences no errors. It simply does not display the metadata.

## 7. UI Integration

### 7.1 Session Title in History Panel

The History panel currently displays each session entry with the session ID, timestamp, operation count, file count, and a brief description. With metadata, the session title appears prominently at the top of each entry, displayed in the same type size and weight as the session ID. The session ID moves to a secondary position below or beside the title, rendered in the muted text style. When no session title is present — which is the case for all legacy sessions and any new session that omits the optional metadata — the display falls back to showing the session ID in the primary position, which is the existing behavior. The fallback is invisible to the user: it is simply the current rendering path.

### 7.2 Session Title in Unified Results Panel

The Unified Results Panel, which shows the results of the most recent session, displays the session title at the top if it is present. Below the title, the session ID and timestamp appear as secondary information. If the title is absent, the panel shows the session ID in the same position, maintaining the current layout.

### 7.3 Session Title in Revert Confirmation

The revert confirmation dialog shows the session title if available, with the session ID below it as supplementary context. If no title is present, the dialog shows the session ID alone, matching the current behavior. The confirmation text reads "Revert session '[title]' (ID: sessionId) to pre-patch state?" when a title is present, and "Revert session 'sessionId' to pre-patch state?" when it is not.

### 7.4 Operation Title in History Panel Operation List

The Session Detail view lists each operation in the session. Currently, each operation entry shows the operation type, file path, and status. With metadata, the operation title appears as the primary label, with the operation type and file path shown as secondary details. When no operation title is present, the operation type and file path remain in the primary position. The layout of each operation entry is unchanged; only the content of the label area changes.

### 7.5 Operation Title in OperationResult Renderer

The operationResultRenderer component, which displays individual operation results inline, shows the operation title as a header above the result details when present. When absent, it shows the operation type and file path as the header, matching the current behavior.

### 7.6 Fallback Behavior

Every UI component that displays metadata follows the same fallback rule: if the metadata field is undefined or the specific subfield (title or description) is undefined, the component renders as if the metadata feature does not exist. The fallback is not a distinct code path; it is the default rendering, with metadata rendering added as an enhancement. This ensures that the introduction of metadata never degrades the display of legacy sessions.

### 7.7 Copy Summary Integration

The Copy Summary feature, which copies a formatted summary of the session to the clipboard, includes the session title and description when present. The summary format changes from:

```
Session BR-20260903-014
3 operations, 5 files affected
Operation 1: Search/Replace in src/foo.ts
```

to:

```
Session BR-20260903-014: Add Validation Pipeline
3 operations, 5 files affected
Ensures all user input is validated before processing

Operation 1: Add input validation function in src/validate.ts
```

The exact format for the summary is: the session ID followed by a colon and the title on the first line, the session description on its own line if present, then the operation count and file count, then each operation with its title if present.

### 7.8 Layout and Styling

No new layout or styling is required beyond what the existing design system provides. Session and operation titles use the same typographic scale as the existing session ID and operation type labels. The title is rendered at the same weight and size as the primary identifier it augments or replaces. The description, when displayed, uses the text-muted style at a slightly smaller size, positioned below the title.

## 8. Master Prompt and Tool Registry Updates

### 8.1 Master Prompt Additions

The master prompt, which instructs the AI on how to generate Brud Blocks, gains a new section about metadata. This section tells the AI that it may optionally include a session title and description after the `<BRUD_INSTRUCTIONS>` block, and operation titles and descriptions inside individual operation blocks. The prompt emphasizes that metadata is purely informational and never affects execution behavior. It instructs the AI to use metadata only when it improves readability — for example, to name a session "Refactor authentication module" or to label an operation "Update error handling in login controller." The prompt must warn the AI never to generate metadata with incorrect case, never to generate duplicate metadata blocks, and never to place metadata outside its valid positions.

### 8.2 Teaching the AI Appropriate Use

The prompt should include guidance on when metadata adds value versus when it is noise. A session that performs a single obvious operation — such as creating one file — does not benefit from metadata because the session ID and operation details are self-explanatory. A session that performs multiple related operations — such as "Add user authentication flow" with operations for creating a login route, a middleware function, and a database query — benefits meaningfully from titles at both the session and operation levels. The AI should be taught to use judgment: metadata is a courtesy to the human reader, not a requirement.

### 8.3 Examples to Include

The master prompt should include one complete example of a Brud Block with session and operation metadata in both legacy and YAML formats. The examples should show correct casing, correct positioning, and appropriate field values. They should also show one example of a block that deliberately omits metadata to demonstrate that metadata is optional.

### 8.4 Metadata as a Pseudo-Tool

The metadata wrappers should not be registered as pseudo-tools in the tool registry. Metadata is not a tool; it is data attached to tools. The AI generates metadata inline within the Brud Block content, not through a separate tool invocation. Adding it to the tool registry would create confusion about whether it can be called independently, which it cannot. The master prompt is the correct place to teach the AI about metadata.

## 9. Edge Cases and Failure Modes

### 9.1 Wrapper Appears in Wrong Position

If `<session_metadata>` appears anywhere other than immediately after `<BRUD_INSTRUCTIONS>`, the parser raises an out-of-position error. This includes cases where it appears between operations or after the first operation. If `<operation_metadata>` appears after the `=======` separator, it is treated as operation content, not metadata. The parser does not attempt to extract it.

### 9.2 Wrapper Appears with Wrong Case

Any wrapper token that is not exactly `<session_metadata>`, `</session_metadata>`, `<operation_metadata>`, or `</operation_metadata>` in lowercase is rejected. The error message includes the expected token. This applies to both opening and closing tags independently.

### 9.3 Wrapper Appears Multiple Times

A second `<session_metadata>` block at the session level is a validation error. A second `<operation_metadata>` block inside the same operation is also a validation error. These are detected during the pre-pass before the main parser runs.

### 9.4 Field Name Has Wrong Case

A line like `Title: My Session` inside a metadata block is invalid. The parser recognizes only `title:` and `description:` in exact lowercase. The error message suggests the correct casing.

### 9.5 Field Value Is Empty

A field name with nothing after the colon, followed by a non-indented line, produces an empty string as the field value. An empty title or description is valid — the parser does not reject empty values. The empty value propagates to the metadata object as an empty string. Downstream consumers that display metadata treat an empty string the same as undefined: they fall back to the default display.

### 9.6 Field Value Contains Angle Brackets

If a metadata value contains `<` or `>` characters, the parser treats them as literal characters within the value. The angle brackets are not interpreted as wrapper tokens because the pre-pass has already extracted and removed the wrapper tokens from the document. However, if the value contains the exact string `</session_metadata>` or `</operation_metadata>`, the parser incorrectly terminates the metadata block at that point. This is a parsing ambiguity that cannot be fully resolved without escape syntax. The design decision is to document this limitation and recommend that users avoid these strings in metadata values. The parser reads from the opening tag to the first occurrence of the closing tag. If the closing tag appears inside a value, the remaining value is lost.

### 9.7 Field Value Contains Newlines Unexpectedly

A field value that spans multiple lines without indentation on subsequent lines is treated as two separate events: the first line is the value, and the subsequent lines are parsed as new field attempts or invalid content. This means a multiline value must use indentation on every continuation line. The parser does not attempt to heuristically determine whether an unindented line is a continuation or a new field.

### 9.8 Multiline Value with No Continuation Lines

A field with a multiline-syntax colon (the field name followed by nothing on the same line) and no indented lines below produces an empty string value. This is valid and not an error.

### 9.9 Metadata Inside a Comment or Code Block

The metadata pre-pass operates on the raw text of the Brud Block document. It does not understand comments or code blocks. If a user writes `<!-- <session_metadata> -->` inside an HTML comment within a code block, the pre-pass sees the wrapper token and attempts to extract metadata from it. This is a known limitation of the pre-pass approach. The design decision is that metadata wrappers inside code blocks are a user error, and the user is expected to know that metadata wrappers are document-level constructs, not code-level constructs. The parser will produce an error in this case, but this is acceptable because the error is correct — the metadata wrapper is being used in a place that does not make semantic sense. In practice, this scenario is highly unlikely because Brud Block documents are structured documents, not free-form text.

### 9.10 Nested Metadata Wrappers

A metadata wrapper inside another metadata wrapper — for example, a `<session_metadata>` block that contains `<operation_metadata>` inside its value — is handled by the pre-pass's straightforward line-scanning approach. The pre-pass looks for the outermost wrapper tokens. The inner wrapper tokens are part of the content and are not parsed as metadata. They survive as literal text within the metadata value. This is acceptable because nesting metadata wrappers has no semantic meaning.

### 9.11 Metadata on an Operation That Fails Validation

If an operation fails validation — for example, a `Search/Replace` operation with no replacement text — the operation is rejected before it reaches the execution engine. The metadata that was attached to this operation is discarded along with the operation itself. The session-level metadata is unaffected. The session is recorded as having a failure status, and the rejected operation does not appear in the recorded operations array. The metadata for the rejected operation is lost, which is correct behavior because there is no valid operation to attach it to.

### 9.12 Metadata on an Operation That Is Aborted

If an operation is aborted by the user during execution, the same rule applies: the operation is not recorded in the session's operations array, so its metadata is discarded.

### 9.13 Metadata Contains the Closing Tag String

If a metadata value contains the literal string `</session_metadata>` or `</operation_metadata>`, the pre-pass terminates at the first occurrence of that string. Any content after that string is not part of the metadata block and may cause a parsing error or be misinterpreted as the next operation. As noted in section 9.6, this is a documented limitation. Users are advised not to include these literal strings in metadata values. A future extension could add escape syntax, but the current design accepts this limitation.

### 9.14 Metadata Contains the Separator String

If a metadata value contains the string `=======` (seven or more equals signs), the pre-pass does not interpret it as a separator because the pre-pass is looking for wrapper tokens, not separators. The main parser, after the pre-pass has stripped the metadata wrapper, receives the cleaned document. If the separator appeared inside a metadata value that was removed, the separator is also removed. This is correct behavior. If the separator appears in an operation metadata value, it is still within the operation block after the wrapper is removed, and the main parser handles it normally.

### 9.15 Extremely Long Titles or Descriptions

No artificial length limit is imposed on title or description values. However, the UI components that display these values are expected to truncate or wrap long text appropriately. The History panel entry, which has a fixed-width layout, clips long titles with an ellipsis and provides the full title as a tooltip. The Session Detail view allows titles and descriptions to wrap naturally. The session.json file stores the full text without truncation. Downstream consumers of the metadata — such as the Copy Summary feature — use the full text. If performance or storage becomes a concern with extremely long values, a future limit can be added, but the current design places no restriction.

### 9.16 Metadata with Unicode, Emoji, or Bengali Characters

Metadata values support the full Unicode range. The parser reads text as-is without encoding restrictions. The JSON serialization layer handles Unicode characters natively. Emoji characters stored in metadata values display correctly in the UI if the user's system supports them. Bengali and other non-Latin script characters are supported without any special handling. The only characters that cause issues are those that interfere with the wrapper token syntax, as described in sections 9.6 and 9.13.

### 9.17 Metadata Preserved Through Revert

When a session is reverted (either to pre-patch or post-patch state), the metadata is not modified. The revert operation affects file content only. The `HistorySession` object, including its `sessionMetadata` and the `metadata` on each `OperationResult`, remains unchanged. The revert is recorded in the revert history, but the metadata fields are not touched.

### 9.18 Metadata in Sessions That Are Reverted and Then Restored

If a user reverts a session and then restores it (applies the post-patch state again), the metadata survives both operations unchanged. The metadata is part of the session record, not part of the file state, so revert and restore have no effect on it.

### 9.19 Metadata in Sessions That Are Deleted and Recovered from Trash

When a session is soft-deleted, its metadata survives because the session directory and `session.json` file remain intact. Only the `isDeleted` flag is set. When the session is restored from trash, the `isDeleted` flag is cleared, and the metadata is still present in the `session.json` file. The metadata is never cleared during delete or restore operations.

### 9.20 Metadata in the Trash Retention System

The trash retention system does not interact with metadata. The retention cleaner deletes expired sessions based on their deletion timestamp, not their metadata content. The metadata does not affect whether a session is retained or deleted. When an expired session is permanently removed, its metadata is removed with it.

### 9.21 Metadata with Special Characters That Could Break JSON Serialization

The metadata values are strings that go through standard JSON serialization. Characters that require escaping in JSON — such as double quotes, backslashes, and control characters — are handled by the JSON serializer. The parser produces plain JavaScript strings, and `JSON.stringify` handles the escaping. No special handling is required in the parser or the UI for JSON-special characters. The only characters that require attention are those that affect the metadata's own syntax, as covered in sections 9.6 and 9.13.

## 10. Sync Points (Every Bridge)

### 10.1 Parser to FileOperation

The parser produces parsed operations with optional metadata. The engine iterates over parsed operations and constructs `FileOperation` objects. At this bridge, the engine copies the `metadata` field from each parsed operation to the corresponding `FileOperation`. If the metadata is undefined, the `FileOperation`'s metadata is undefined. This is a direct one-to-one field copy with no transformation.

### 10.2 FileOperation to OperationResult

The execution engine executes each `FileOperation` and produces an `OperationResult`. At this bridge, the engine copies the `metadata` field from the `FileOperation` to the `OperationResult`. If the metadata is undefined, the `OperationResult`'s metadata is undefined. The copy happens at the time the `OperationResult` is created, which is after the operation completes or fails.

### 10.3 OperationResult to HistorySession Operations Array

The History module records a session by storing an array of `OperationResult` objects. Each `OperationResult` in the array already carries its metadata. No additional copy step is needed. The session recording code simply includes the `OperationResult` objects as-is.

### 10.4 HistorySession to session.json

The History module serializes the `HistorySession` object to JSON and writes it to `session.json`. The `sessionMetadata` field at the top level and the `metadata` field on each operation are serialized naturally. If either is undefined, the JSON omits the key. If either is present, the JSON includes it. This is standard JSON serialization with no custom logic.

### 10.5 session.json to HistorySession on Load

The History module reads `session.json` and deserializes it into a `HistorySession` object. The `sessionMetadata` and operation-level `metadata` fields are deserialized from the JSON if present, or left as undefined if absent. This is standard JSON deserialization with no custom logic.

### 10.6 HistorySession to UI State

The History module exposes session data to the UI layer through its state management. The `sessionMetadata` and operation-level `metadata` fields are passed through as part of the session state object. The UI layer reads these fields when rendering session and operation displays.

### 10.7 UI State to Rendered DOM

The UI components that render session entries and operation entries read the metadata from the state object and render it conditionally. The rendering logic checks for the presence of each metadata subfield and renders it if present, falling back to the default display if absent.

### 10.8 Revert Flow: Metadata Survival

The revert flow reads the `HistorySession` from storage, performs file operations to undo changes, and records the revert in the revert history. It does not modify the `sessionMetadata` or operation-level `metadata` fields. These fields pass through the revert flow untouched. After the revert completes, the session's metadata is still present in `session.json`.

### 10.9 Restore Flow: Metadata Survival

The restore flow clears the soft-delete flags on a session. It does not touch the metadata fields. After restore, the metadata is present exactly as it was before the deletion.

### 10.10 Trash Flow: Metadata Survival

The soft-delete flow sets `isDeleted` and related flags on `session.json`. It does not touch the metadata fields. The metadata survives in the trashed session until the session is permanently deleted.

### 10.11 Wipe Flow: Metadata Deletion

The wipe flow deletes the entire session directory, including `session.json`. All metadata is deleted with the session file. No special handling of metadata is needed during wipe.

## 11. Testing Strategy

### 11.1 Parser Tests

Parser tests cover every combination of valid metadata, invalid metadata, and edge cases. The valid cases include: session metadata with title only, session metadata with description only, session metadata with both, operation metadata with title only, operation metadata with description only, operation metadata with both, all operations in a session with metadata, some operations with metadata and some without, and both wrappers present simultaneously. The invalid cases include: every error condition listed in section 5.1, wrapper with wrong case, field with wrong case, duplicate metadata, out-of-position metadata, unclosed wrapper, and unrecognized field names. The edge cases include: empty values, multiline values, Unicode values, emoji values, values containing angle brackets, values containing separator strings, and values that look like wrapper tokens.

### 11.2 Storage Tests

Storage tests verify the write-read round-trip for session files with metadata. These tests create a `HistorySession` with session metadata and operation metadata, serialize it to JSON, write it to a temporary file, read it back, and verify that the deserialized object has the same metadata. Tests also verify that sessions without metadata serialize and deserialize correctly, and that sessions with only session-level metadata (no operation metadata) and vice versa work correctly.

### 11.3 UI Tests

UI tests verify that titles display correctly in the History panel, the Session Detail view, the Unified Results Panel, and the revert confirmation dialog. Tests verify the fallback behavior: sessions without metadata display the session ID, and operations without metadata display the operation type and file path. Tests verify that long titles are truncated with an ellipsis in the History panel list view.

### 11.4 Revert and Restore Tests

Revert and restore tests verify that metadata survives both operations. These tests create a session with metadata, revert it, verify that the metadata is still present, restore it, and verify that the metadata is still present. Tests also verify that soft-delete and restore from trash preserve metadata.

### 11.5 Integration Tests

Integration tests run the full pipeline from Brud Block text to history panel display. These tests submit a Brud Block with metadata, verify that the parser extracts it correctly, verify that the `FileOperation` objects carry it, verify that the `OperationResult` objects carry it, verify that the `HistorySession` stores it, verify that the `session.json` file contains it, and verify that the UI renders it. A single end-to-end test covers the entire chain.

## 12. Implementation Sequence

The implementation proceeds in the following order. Each step depends on the steps before it.

Step one: define the metadata types. Create the session metadata and operation metadata type definitions in the shared types file. Add the optional `sessionMetadata` field to the parser return type and the `HistorySession` type. Add the optional `metadata` field to the parsed operation type, the `FileOperation` type, and the `OperationResult` type. No behavior changes yet — only type definitions. Verify that the project compiles without errors.

Step two: implement the shared metadata parsing utility. Write a pure function that accepts a string of key-value lines and returns a metadata object. Include field name validation, multiline indentation handling, and error collection. Test this utility in isolation with every valid and invalid input pattern.

Step three: implement legacy format metadata extraction in the parser. Add the pre-pass logic that scans for `<session_metadata>` and `<operation_metadata>` wrappers, extracts their content, and removes them from the document. Implement the state machine for each wrapper type. Implement the index-based metadata attachment to parsed operations. Test with every legacy format variant.

Step four: implement YAML format metadata extraction. Add the pre-pass logic that checks for `session_metadata:` and `operation_metadata:` keys in the parsed YAML structure. Implement key removal before passing to the existing YAML operation parser. Test with every YAML format variant.

Step five: create the `parseOperationsWithMetadata` function. This function calls the metadata pre-pass (legacy or YAML depending on format detection), passes the cleaned document to the existing `parseOperations`, attaches metadata to each operation by index, and returns the combined result with session metadata. Test that it produces correct output for every metadata combination. Test that it produces identical output to `parseOperations` when no metadata is present.

Step six: update the engine to propagate metadata from parsed operations to `FileOperation` objects, and from `FileOperation` to `OperationResult`. This is a small change in the operation construction code. Verify that metadata flows through the execution pipeline.

Step seven: update the History module to store `sessionMetadata` in `HistorySession` and to include the `metadata` field on each stored operation. Update the serialization and deserialization code if needed. Verify that sessions with metadata are written and read correctly.

Step eight: update the UI components. Add session title display to the History panel entry, the Unified Results Panel header, and the revert confirmation dialog. Add operation title display to the Session Detail view's operation list and the operationResultRenderer. Implement fallback behavior for missing metadata. Update the Copy Summary feature to include metadata.

Step nine: update the master prompt. Add the metadata section with usage guidance and examples.

Step ten: write all tests. Parser tests, storage tests, UI tests, revert and restore tests, and integration tests.

Step eleven: run the full test suite and verify that all existing tests pass unchanged. Verify that the new tests pass. Perform manual testing of the History panel, Session Detail view, revert flow, and trash flow with sessions that have metadata and sessions that do not.

## 13. Risks and Open Questions

### 13.1 Parser Performance Impact

The metadata pre-pass adds a second scan of the document text. For large Brud Block documents with many operations, this doubles the parse time. The pre-pass is a simple line scan, so its performance impact should be negligible for documents of typical size (tens to low hundreds of operations). For documents with thousands of operations, the pre-pass adds milliseconds of overhead. If performance becomes a concern, the pre-pass can be merged into the main parser's single scan, but this would increase the complexity of the main parser. The current design optimizes for simplicity over performance.

### 13.2 YAML Format Ambiguity

The YAML format's `session_metadata:` and `operation_metadata:` keys could conflict with user-defined keys in custom YAML structures. If a user has a legitimate reason to use these key names for non-metadata purposes, the parser would misinterpret them. This is a design trade-off: the convenience of automatic metadata extraction outweighs the theoretical risk of key collision. If collisions become a problem in practice, a future version could require a prefix like `brud_metadata:` or a dedicated namespace.

### 13.3 AI Adoption

The feature's value depends on the AI adopting metadata generation as a habit. The master prompt teaches the AI when and how to use metadata, but prompt adherence varies across models and versions. The metadata system is designed so that even if the AI never generates metadata, the system works exactly as before. The feature provides value only when the AI uses it consistently.

### 13.4 Truncation Policy for UI Display

The design document leaves the exact truncation behavior (character count, truncation indicator) to the UI implementation phase. A specific truncation limit should be chosen during UI implementation based on the layout constraints of each component. The History panel list entry might truncate at 50 characters, while the Session Detail view might show the full title. These decisions are deferred to the UI implementation.

### 13.5 Multiline Description in Copy Summary

The Copy Summary feature's treatment of multiline descriptions needs a precise wrapping policy. Should the description appear as a single paragraph with line breaks collapsed, or should the original line breaks be preserved? The current design leans toward preserving the original formatting, but this decision should be confirmed during implementation.

## 14. Future Extensions

### 14.1 Metadata-Enabled Search and Filter

The most immediately valuable downstream feature is the ability to search and filter history by metadata. With titles and descriptions stored in `session.json`, the History module can offer a search box that matches against session titles, operation titles, and descriptions. Users could find a session about "authentication" by typing that term into the search box instead of scanning through dozens of entries. Sessions could also be grouped by title keywords or filtered to show only sessions with certain operation titles.

### 14.2 Automated Documentation Generation

Session metadata provides the raw material for automated changelogs and release notes. A future feature could aggregate session titles and descriptions across a date range and produce a Markdown document summarizing what changed. The session-level description, which captures the intent of a group of operations, maps naturally to a changelog entry. The operation-level titles map to bullet points under that entry.

### 14.3 Session Replay from Metadata

Metadata could enable a guided replay mode where the user steps through a session operation by operation, with the title and description displayed at each step. This would be useful for code review, onboarding, and educational contexts. The metadata provides the descriptive layer that makes replay meaningful beyond showing file diffs.

### 14.4 Metadata Validation Rules

Future versions might support custom field names beyond `title` and `description`, or support field validation rules such as required fields, field limits, or field patterns. The current design uses a fixed set of optional fields to keep the initial implementation simple, but the parser architecture — a shared utility that extracts key-value pairs — is compatible with extensible field sets.

### 14.5 What Not to Add Now

Several features are explicitly out of scope for the initial implementation. Metadata editing after session creation is not supported — once a session is recorded, its metadata is immutable. Metadata in the Brud Prompt itself (the natural language instruction to the AI) is not supported — metadata exists only in the Brud Block that the AI generates. Metadata in terminal command output is not supported. Metadata on individual file snapshots is not supported. These features are left for future consideration, and the current design does not constrain their addition.