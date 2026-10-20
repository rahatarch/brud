# MCP Subsystem

## What It Is

The Model Context Protocol subsystem lets an external AI client call Brud Code's file, search, and terminal operations through a standard protocol instead of a human pasting output into the editor.

## Why It Exists

Brud Code's clipboard workflow requires a person in the loop. Some workflows do not have one: a desktop assistant, an editor-native agent, or a headless pipeline each need to invoke the same guarded operations directly. This subsystem provides that path without creating a second execution engine or a second security model.

Every call flows through the same kernel, the same workspace containment, and the same history store as an editor session. Aliases, bypasses, and trusted-client shortcuts do not exist.

## Core Concepts

**Workspace anchor.** The server does not assume its launch directory is the project. A workspace path is supplied at start-up (an argument or `BRUD_MCP_WORKSPACE`), canonicalized with symbolic links resolved, and used as the enforcement root for every call.

**Tool catalog.** The list of tools is synthesized on demand from the shared tool registry (`globalToolRegistry`). There is no hand-maintained mirror. Each documented operation becomes one tool with a strict JSON schema: declared properties, required fields, defaults, and `additionalProperties: false`.

**Parameter bridge.** Client arguments use documented names (`filePath`, `scope`, `pattern`), while the engine expects operation fields (`path`, `directory`, `patterns`). The bridge renames, reshapes, fills documented defaults, and rejects anything it cannot map. Path-bearing values are resolved against the anchor, so the server's working directory never affects which file is touched.

**Dispatcher.** The only component that calls the kernel. It translates a protocol call into `BrudKernel.execute`, maps the result to protocol content, and passes every outgoing string through a sanitizer that removes workspace prefixes and stack frames.

**Transports.** Standard input/output for clients that own a child process, and loopback HTTP (streamable form, JSON responses) for clients that connect to an endpoint.

## In The Editor

The Brud Code extension ships this server. Open **Brud Code: Open Brud Code Management** and select the **MCP** tab.

- The tab shows the live state (Stopped, Starting, Running, Stopping), the endpoint, and which project the client is being given access to.
- **Start** and **Stop** control the listener; both are disabled while a transition is in progress.
- **Start when a project opens** is stored as `mcpAutoOn` in `.brud/settings.json`. It defaults to enabled; turning it off stops a running server immediately.
- **Copy connection details** places a single-server client configuration pointing at the live endpoint on the clipboard.
- Switching projects restarts the server against the new folder, and editing `.brud/settings.json` applies new boundary, command-validation, and tool allow-list rules to the next call without a restart.

The listener binds loopback only. There is no authentication, so any local process can reach the tools while it is running.

## Headless Usage

Build the server:

```bash
npm install
npm run build:mcp
```

Process-pipe client configuration:

```json
{
  "mcpServers": {
    "brud": {
      "command": "node",
      "args": ["/absolute/path/to/brud/packages/mcp/dist/cli.js", "/absolute/path/to/project"]
    }
  }
}
```

HTTP client:

```bash
brud-mcp /absolute/path/to/project --http --port 7717
curl -s -X POST http://127.0.0.1:7717/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Append `--timeout <seconds>` to either transport to change the per-call deadline.

## API Reference

### `bootMcpWorkspace(workspaceCandidate: string): Promise<McpWorkspace>`

Resolves the workspace, builds the headless ports, and boots the kernel.

Returns an object with `kernel`, `workspaceRoot`, `fileSystem`, `historyStore`, and `settings`. Throws when the path is not a directory.

### `resolveWorkspaceRoot(candidate: string): string`

Resolves symbolic links where possible and returns an absolute directory path. Throws for a missing path or a non-directory.

### `loadWorkspaceSettings(workspaceRoot: string): BrudSettings`

Reads `<workspace>/.brud/settings.json` and overlays it on `DEFAULT_SETTINGS`. Malformed or absent files yield the defaults. The same file governs the editor, so a project's boundary and command-validation choices apply identically to both input sources.

### `getToolCatalog(): ToolCatalog`

Returns `{ tools, excluded }`. `tools` holds one descriptor per documented operation; `excluded` lists any tool skipped because of a catalog defect, with a reason. Never throws for a well-formed registry.

### `buildToolCatalog(docs: readonly ToolDoc[]): ToolCatalog`

The pure form of the above, for testing or for a caller that supplies its own documentation set.

### `normalizeArguments(kind, args, workspaceRoot): NormalizeResult`

Returns `{ ok: true, input }` or `{ ok: false, code, message }` where `code` is one of `UNKNOWN_TOOL`, `UNKNOWN_PARAMETER`, `MISSING_PARAMETER`, or `INVALID_TYPE`. It never throws and never coerces a value it cannot map. The returned input includes `kind` and a fixed `index` and never accepts client-supplied values for either.

### `getToolParameterNames(kind: string): readonly string[] | undefined`

The parameter names the bridge accepts for a kind. Used to prove catalog and bridge stay in sync.

### `dispatchToolCall(kernel, kind, args, options): Promise<ToolCallResult>`

Validates, executes, and returns `{ isError, content, code? }`. Invalid input is refused before the kernel is called. A thrown or malformed kernel result becomes `INTERNAL_ERROR` with a reference identifier and no diagnostic detail.

### `sanitizeText(text: string, workspaceRoot: string): string`

Removes the workspace prefix (replacing it with a relative marker) and drops stack-frame lines.

### `createBrudMcpServer(workspace, identity?, options?): Promise<Server>`

Builds a protocol server advertising only the `tools` capability. `options.signal` aborts in-flight execution.

### `startStdioServer(workspaceCandidate, identity?, options?): Promise<StartedStdioServer>`

Boots the workspace, builds the server, and connects the stdio transport. Standard output carries protocol frames only. `options.executionTimeoutMs` sets the per-call deadline; the CLI supplies 120 seconds unless `--timeout` overrides it.

### `startHttpServer(workspaceCandidate, options?): Promise<StartedHttpServer>`

Options: `port` (fixed or ephemeral when omitted), `host` (must be loopback), `path` (default `/mcp`), `executionTimeoutMs` (default 120000), `identity`. Returns `{ port, host, path, url, workspaceRoot, close }`. A busy fixed port fails at start-up.

## How To Test It

```bash
npm run test --workspace @brud/mcp
```

From the repository root, `npm run test:mcp` runs the same suite and is part of `npm run ci`. Tests use `node:test` through `tsx`, spawn the real stdio server over pipes, and start a real HTTP listener. There is no Electron dependency.

## How To Extend It

**Add a tool.** Register the operation and its documentation in `packages/core/src/tool-registry/init.ts`, then add a matching entry to `TOOL_SPECS` in `packages/mcp/src/normalize.ts`. The catalog is generated from the registry, so no catalog code changes. Two tests enforce the contract: every documented tool must have a spec, and every spec key must be documented.

**Add a transport.** Implement it against `createBrudMcpServer`, call `dispatchToolCall` for execution, and keep diagnostics off the protocol channel. Follow `src/http.ts` for port policy and cancellation.

**Add a parameter.** Document it in the tool registry, map it in `normalize.ts`, and set a default only if the engine tolerates the field being present. Prefer omitting a field when "absent" and "zero" mean different things.

## Edge Cases & Gotchas

- **Relative paths.** The bridge converts every path to an absolute path anchored at the workspace. This is deliberate: pass-through relative paths would resolve against the server's launch directory.
- **`maxResults` semantics.** Core treats an absent result cap as unlimited. Sending `0` means zero results. The bridge omits the field rather than defaulting it.
- **Comma splitting.** `pattern` and `exclude` accept comma-separated strings. Commas inside `{}`, `[]`, or `()` are preserved so brace globs such as `**/*.{ts,tsx}` survive.
- **`onSuccess` / `onFailure`.** A single command string is wrapped into a sequential command group. Nested structured groups are not accepted from clients.
- **`get_tool_info`.** It is a registry operation but not a client tool; the bridge refuses it as `UNKNOWN_TOOL`.
- **HTTP is stateless.** Each request creates its own server and transport. There are no sessions and no server-initiated notifications.
- **Loopback only.** Binding any non-loopback host is refused. There is no authentication, so exposing the port is not supported.
- **Backslashes and platforms.** Path anchoring uses Node's platform rules; results differ on Windows only in separator form.
- **Deadlines.** Every call has a deadline (120 seconds by default, `--timeout <seconds>` to change it). When it expires the client receives an error result and the running command is stopped, not left running in the background.
- **Client disconnects.** If an HTTP client drops the connection mid-call, the running command is stopped the same way.
- **Interactive commands.** `terminal_interactive` cannot be interrupted once it starts; a deadline or disconnect prevents the next operation from starting but does not kill a running interactive session.
- **Aborted batches.** Operations that finished before an abort stay applied and are recorded in history, so they can be reverted like any other change.

## Related Docs

- [Package README](../../packages/mcp/README.md) — module map and exports
- [MCP subsystem design specification](../architecture/mcp-subsystem-design.md) — the approved architecture this implementation follows, with §9 recording which parts of it are enforced today
- [Microkernel architecture specification](../architecture/microkernel-architecture-spec.md) — the invariants the wrapper must not weaken
