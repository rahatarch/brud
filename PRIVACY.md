# Privacy

Brud Code's project history, diffs and revert data stay on your machine. This page
describes the one thing that leaves it: anonymous operation records that help us find and
fix bugs. It lists exactly what is sent, exactly what is not, and how you can verify both.

Release builds of Brud Code are produced from the proprietary Brud codebase. The engine
and extension in this repository are the open-source core; release builds add the telemetry
client, the receiving service, the admin console and the integration files that connect
them. Those are not in this repository, which is why this page documents behaviour by
example and by the network traffic it produces rather than by linking to their code.

## What is sent

Telemetry is emitted by every component that runs the Brud engine: the VS Code
extension, the MCP server it hosts, and the `brud-mcp` CLI. There are two kinds of
request.

**1. Operation records** — `POST https://api.brudcode.com/v1/telemetry/events`

Sent after a Brud operation completes, or when a buffered record is retried. One Brud
prompt becomes one record. Every record carries these envelope fields:

| Field | Meaning |
|---|---|
| `eventId` | Random UUID for this record, used so a retry cannot be stored twice |
| `sessionId` | Random UUID for the execution; a grouped prompt record uses the prompt identifier |
| `anonymousClientId` | The anonymous installation identifier described below |
| `toolKind` | Which operation ran, e.g. `create_file`, `terminal_command`, `multi_operation` |
| `status` | `success`, `failed`, `aborted` or `interrupted` |
| `durationMs` | How long it took |
| `errorCode` | A stable code such as `FILE_NOT_FOUND`, when the record failed |
| `clientVersion` | The version of the build that produced the record |
| `batch`, `batchId` | Grouping when one prompt produced several operations; `batch` is false otherwise |
| `payload` | The structured detail shown below |

**Successful record, two operations from one prompt:**

```json
{
  "eventId": "6f1c2a44-1b6e-4c5d-9d4a-0f2a1b3c4d5e",
  "sessionId": "d0b7f5a1-8c1e-4f2a-9b3d-7e6f5a4b3c2d",
  "anonymousClientId": "720aff2d-7df8-4cdb-a159-7a4bf3eb78aa",
  "toolKind": "multi_operation",
  "status": "success",
  "durationMs": 1427,
  "clientVersion": "<build version>",
  "batch": true,
  "batchId": "d0b7f5a1-8c1e-4f2a-9b3d-7e6f5a4b3c2d",
  "payload": {
    "operations": [
      { "index": 0, "kind": "create_directory", "status": "success", "durationMs": 211 },
      { "index": 1, "kind": "create_file", "status": "success", "durationMs": 96 }
    ],
    "fileOperations": [
      { "operationIndex": 0, "kind": "create_directory", "status": "success",
        "path": "{path}", "files": ["a.txt", "b.txt"], "directoryPath": "{path}" },
      { "operationIndex": 0, "kind": "create_file", "status": "success",
        "path": "{path}.txt" }
    ],
    "expectedOperations": 2,
    "receivedOperations": 2,
    "operationCount": 2,
    "failedOperations": 0,
    "abortedOperations": 0,
    "interruptedOperations": 0,
    "succeededOperations": 2
  }
}
```

**Failed record**, with the diagnostics that make it useful:

```json
{
  "eventId": "0b8f4f65-1f0e-4c2b-9a2e-1c9b7d3e5a41",
  "sessionId": "c5597c74-3a2b-4f1e-8d6a-2b9c8e7f6a5d",
  "anonymousClientId": "720aff2d-7df8-4cdb-a159-7a4bf3eb78aa",
  "toolKind": "read_file",
  "status": "failed",
  "durationMs": 73,
  "errorCode": "FILE_NOT_FOUND",
  "clientVersion": "<build version>",
  "payload": {
    "operationMessage": "All operations failed.",
    "fileOperations": [
      { "operationIndex": 0, "kind": "read_file", "status": "failed",
        "message": "No file found at \"{path}.ts\"." }
    ],
    "diagnostics": {
      "category": "user_input",
      "categorySource": "error-code",
      "code": "FILE_NOT_FOUND",
      "settings": {
        "workspaceBoundaryEnabled": true,
        "commandValidationEnabled": true,
        "terminalAvailable": true,
        "mcpAutoOn": true,
        "disabledTools": [],
        "toolCount": 20
      },
      "settingsCapturedAt": "2026-10-21T08:00:00.000Z",
      "logsIncluded": true,
      "logs": [
        { "sequence": 41, "level": "info", "message": "[brud] workspace {workspace}" }
      ],
      "logsTruncated": false,
      "droppedLogLines": 0
    }
  }
}
```

Failure records carry, at most:

- the operation's message, redacted and capped at 4 KiB with a visible `…[truncated]` marker;
- a category (`user_input`, `policy`, `environment`, `side_effect`, `engine`, `transport`, `unknown`), the stable error code and the input that decided it;
- the settings fields shown above — the security posture in force at the time, never paths or prompts (values that are unknown are omitted);
- for a failed operation, up to 50 lines or 4 KiB of Brud's own debug log, redacted, with a truncation flag and dropped-line count.

For a prompt with several operations, each failed operation keeps its own diagnostics, while
the record-level summary carries only the category and counts.

**2. Control state** — `GET https://api.brudcode.com/v1/telemetry/state`

Fetched when the engine starts and then about every five minutes. The request has no body
and carries no identifier beyond transport-level metadata. The response is one of:

```json
{ "active": true, "retryAfterSeconds": 60 }
```

It exists so telemetry can be paused centrally during an incident. While paused, records
are kept locally and nothing is transmitted until the next check reports active again.

## The anonymous identifier

`anonymousClientId` is a random UUID v4 created on first run and stored on your machine:

| Platform | Path |
|---|---|
| Linux | `~/.config/brud/client_id` |
| macOS | `~/Library/Application Support/brud/client_id` |
| Windows | `%APPDATA%\brud\Config\client_id` |

It is created with owner-only permissions (`0600`) inside an owner-only directory (`0700`).
It is not derived from your hardware, hostname, username, network address or any file path,
and it is shared by every Brud component on that OS account so one installation is counted
once. Deleting the file gives you a new identity on the next run.

## What is not sent

- **File contents.** Reading a file succeeds or fails, but the text is not transmitted.
  Successful records contain only structure: operation index, kind, status, duration, paths.
- **Command output on success.** `terminal_command` records whether it succeeded and how
  long it took, not what it printed.
- **Your prompts.** The instruction you typed is not part of any record.
- **Your source code, diffs, history, snapshots or revert data.** These stay in your
  workspace under `.brud/`.
- **Absolute paths.** Paths in structural fields are rewritten to `{path}` plus the
  extension, e.g. `/home/you/project/src/app.ts` becomes `{path}.ts`.
- **Credential patterns.** The following are replaced with `{redacted}` before sending:
  `Authorization:`/`Bearer` tokens, `sk-…` keys, GitHub `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`
  tokens, GitLab `glpat-` tokens, Slack `xox[baprs]-` tokens, AWS `AKIA…` keys, JWTs,
  PEM private-key blocks, credentials embedded in URLs, and values assigned to
  `*_PASSWORD`, `*_PASSWD`, `*_SECRET`, `*_TOKEN`, `*_API_KEY` or `*_PRIVATE_KEY`.
- **Hardware or network identifiers.** The records stored in our database contain no IP
  address, MAC address, hostname, username or hardware fingerprint. Operational server logs
  and network providers may see connection metadata such as source address and timestamp,
  as with any HTTPS request.
- **Environment dumps or settings files.** Only the settings fields listed above are sent, and unknown values are omitted.

## What is sent on failure, and why it needs saying twice

A failure record may include the Brud debug log for the failing operation and the output of
a failed terminal command, because that is usually the only thing that explains the failure.
Those strings are redacted by the patterns above, not reviewed by a person before sending.
Two honest consequences:

- A secret in a format we do not recognise can pass through. If a command prints one and
  fails in the same operation, treat that output as transmitted.
- In debug logs, your home directory and workspace root become `{home}` and `{workspace}`,
  but an absolute path outside those two may remain. Other absolute paths in structural
  fields are rewritten as described above.

## Retention

Records are stored in our PostgreSQL database. There is no automatic expiry at present.
To have records associated with your identifier removed, open an issue at
<https://github.com/rahatarch/brud/issues> and include the value of your `client_id` file.

## Your controls

- **Server pause.** The operator can pause telemetry for every client. Your client keeps
  records locally and sends nothing while paused.
- **Reset identity.** Delete your `client_id` file.
- **Clear local buffer.** Delete the spool directory used when the server is unreachable:
  `~/.cache/brud/telemetry/` on Linux, `~/Library/Caches/brud/telemetry/` on macOS, or
  `%LOCALAPPDATA%\brud\Cache\telemetry\` on Windows.
- **No local opt-out yet.** There is no user-facing switch to disable telemetry at present.
  Until one exists, the server pause is the only way to stop transmission, and it is operated
  by us, not by you. This paragraph is here so the limitation is not discovered later.

## How to verify this yourself

1. **Read the buffer.** When the server is unreachable, records wait as plain JSON lines in
   the spool path above (`pending.ndjson`, `0600`). You will see the exact payloads shown on
   this page.
2. **Watch the network.** Point a proxy or packet capture at the VS Code extension host and
   observe requests to `api.brudcode.com`. There are only the two endpoints listed above.
3. **Read the shipped bundle.** The extension in the VSIX is minified but not encrypted:
   `extension/dist/extension.js` inside the package contains the code that builds these
   payloads, including the redaction patterns.
4. **Check what is absent.** Search the captured traffic or the spool for a known string
   from a file you read, or from a command that succeeded. It will not be there.

If any of this does not match what you observe, that is a bug worth reporting, and the
description here is what should change.
