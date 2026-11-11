# MCP Subsystem

> **Status (Phase 10, 2026-11-05):** `packages/mcp` has been deleted. MCP is now served by the `brud.mcp.bridge` plugin inside the daemon, and the daemon's `--stdio` mode is the only stdio entry point. `brud daemon --stdio --workspace <path>` replaces the former standalone `brud-mcp` process. The remaining sections describe the retired implementation and are retained as historical design context.

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

The daemon hosts this server. The client that renders the management tab lives in the product repository; this foundation contains no client.

- The tab shows the live state (Stopped, Starting, Running, Stopping), the endpoint, and which project the client is being given access to.
- **Start** and **Stop** control the listener; both are disabled while a transition is in progress.
- **Start when a project opens** is stored as `mcpAutoOn` in `.brud/settings.json`. It defaults to enabled; turning it off stops a running server immediately.
- **Copy connection details** places a single-server client configuration pointing at the live endpoint on the clipboard.
- Switching projects restarts the server against the new folder, and editing `.brud/settings.json` applies new boundary, command-validation, and tool allow-list rules to the next call without a restart.

The listener binds loopback only. There is no authentication, so any local process can reach the tools while it is running.

In the client, one window asks for local port 8899 so the endpoint stays stable across reloads; windows that lose that port fall back to a free one and take it over when it becomes available. The port is local either way — see [PRIVACY.md](../../PRIVACY.md) for what the daemon does with network traffic.

## Headless Usage

Build the daemon, kernel, and MCP bridge plugin:

```bash
npm install
npm run build:kernel
npm run build:daemon
npm run build --workspace @brud/plugin-mcp-bridge
```

Process-pipe client configuration:

```json
{
  "mcpServers": {
    "brud": {
      "command": "brud",
      "args": ["daemon", "--stdio", "--workspace", "/absolute/path/to/project"]
    }
  }
}
```

Or run the built daemon directly:

```bash
node packages/daemon/dist/cli.js --stdio --workspace /absolute/path/to/project
```

The daemon binds stdin/stdout as the MCP transport for plugins that declare `transports: ['stdio']`. It does not bind the Unix-domain socket in this mode, and diagnostics go to stderr so the stdout stream stays a clean newline-delimited JSON-RPC channel. There is no separate `brud-mcp` binary.

A normally launched daemon still hosts the loopback HTTP transport through the bridge plugin and writes its endpoint to `.brud/mcp-endpoint.json`.

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
node --import tsx --test packages/daemon/src/__tests__/stdioMode.test.ts
```

The end-to-end test spawns a real daemon with `--stdio`, exchanges real MCP JSON-RPC messages over real stdin/stdout, and asserts `initialize`, `tools/list`, successful `tools/call`, unknown-tool `isError`, and clean exit when stdin closes.

The plugin suite lives at `packages/plugins/MCPBridge/src` and runs the bridge over an in-process `IMcpTransport`.

## How To Extend It

**Add a tool.** Register it in the owning plugin's `activate` hook through `context.registerTool(...)`. The MCP bridge lists whatever the kernel's `BrudTools` service exposes; there is no separate catalog to maintain.

**Add a transport.** Add the transport kind to the plugin manifest's `transports` array and implement `onTransportAttach`. The daemon owns construction and lifetime of `StdioMcpTransport` and `HttpMcpTransport` in `packages/daemon/src/mcpTransport.ts`.

**Add a parameter.** Declare it in the plugin tool's `parametersSchema`; the bridge forwards the schema directly to MCP clients.

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

- [MCP subsystem design specification](../architecture/mcp-subsystem-design.md) — the historical design specification; the daemon-hosted bridge supersedes the standalone package
- [Microkernel architecture specification](../architecture/microkernel-architecture-spec.md) — the invariants the wrapper must not weaken
