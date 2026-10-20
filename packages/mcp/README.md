# @brud/mcp

Exposes Brud Code's file, search, and terminal operations to any Model Context Protocol client.

## Purpose

Brud Code normally receives instructions from a human who pastes AI output into the editor. This package provides the second, programmatic path: an external AI client connects to Brud and calls its tools directly.

It is a wrapper, not a second engine. Every call is translated into the same operation input the editor produces, dispatched through the same kernel, validated by the same workspace containment, and recorded by the same history system. Nothing in this package bypasses Brud's execution path, and no core behaviour was changed to accommodate it.

Two transports are provided: standard input/output for clients that own a child process, and loopback HTTP for clients that connect to a local endpoint.

## Installation

The package is part of the monorepo workspace and is not published separately.

```bash
npm install
npm run build:mcp
```

This produces `packages/mcp/dist/cli.js`, the server entry point.

## Key Public API

| Export | Purpose |
|---|---|
| `bootMcpWorkspace(path)` | Canonicalizes a workspace path, assembles the file system, history store, terminal executor and settings, and boots the core kernel |
| `startStdioServer(path, identity?)` | Boots the workspace and serves the protocol over standard input/output |
| `startHttpServer(path, options?)` | Boots the workspace and serves the protocol over loopback HTTP; returns the bound port and a `close()` handle |
| `createBrudMcpServer(workspace, identity?, options?)` | Builds the protocol server object without connecting a transport |
| `getToolCatalog()` / `buildToolCatalog(docs)` | Synthesizes protocol tool descriptors from the shared tool registry |
| `normalizeArguments(kind, args, workspaceRoot)` | Translates client arguments into the engine's operation input, or returns a coded refusal |
| `dispatchToolCall(kernel, kind, args, options)` | Validates, executes, and returns a sanitized result envelope |
| `sanitizeText(text, workspaceRoot)` | Removes workspace prefixes and stack frames from text before it leaves the server |
| `resolveWorkspaceRoot(path)` | Resolves symbolic links and verifies the path is a directory |
| `loadWorkspaceSettings(root)` | Reads `.brud/settings.json` over the core defaults |

The `brud-mcp` binary accepts a workspace path plus optional flags:

```bash
brud-mcp /path/to/project                          # stdio transport
brud-mcp /path/to/project --http --port 7717       # loopback HTTP on a fixed port
brud-mcp /path/to/project --http                   # loopback HTTP on a free port
```

The workspace can also be supplied through `BRUD_MCP_WORKSPACE`.

## Child Modules

| Module | Purpose |
|---|---|
| `src/bootstrap.ts` | Workspace resolution, settings overlay, port assembly, kernel boot |
| `src/catalog.ts` | Tool descriptor synthesis from `ToolDoc` entries, including JSON schema inputs |
| `src/normalize.ts` | Per-tool parameter mapping, path anchoring, strict rejection |
| `src/dispatch.ts` | Kernel invocation, result translation, fail-closed error text |
| `src/server.ts` | Protocol server construction and the stdio transport |
| `src/http.ts` | Loopback HTTP transport, port policy, per-request timeout |
| `src/cli.ts` | Command-line entry point |

## How It's Used

A stderr/stdout client launches the server as a child process and names the workspace:

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

Clients that prefer HTTP start the server with `--http` and connect to `http://127.0.0.1:<port>/mcp`. The bound URL is written to standard error at startup.

## Testing

```bash
npm run test --workspace @brud/mcp   # from the repository root: npm run test:mcp
```

The suite runs on `node:test` through `tsx` and covers catalog synthesis, parameter mapping, dispatch behaviour, and both transports, including a spawned server driven over real pipes and a real HTTP listener.

## Deeper Documentation

- [MCP client setup and reference](../../docs/mcp/README.md) — connection examples, API reference, extension guide, and known limits

## Dependencies

| Dependency | Why |
|---|---|
| `@brud/core` | Boots the kernel, supplies the tool registry, and provides the Node file system and history store used headlessly |
| `@brud/kernel` | Types for the kernel and its execution contract |
| `@modelcontextprotocol/sdk` | Protocol types, request schemas, and transport implementations |
