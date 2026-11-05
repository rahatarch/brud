import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type {
  IMcpTransport,
  IPluginManagerService,
} from '@brud/kernel' with { 'resolution-mode': 'import' };
import { loadKernelModule } from './kernelRuntime.js';
import type { KernelWorkspace } from './workspaceRegistry.js';

/** MCP endpoint file written under `.brud/` for HTTP transports. */
export const MCP_ENDPOINT_RELATIVE_PATH = '.brud/mcp-endpoint.json';

/** Hard ceiling for one HTTP request body. */
export const MAX_MCP_HTTP_BODY_BYTES = 8 * 1024 * 1024;

type McpMessageHandler = (msg: unknown) => Promise<unknown>;

interface JsonRpcEnvelope {
  readonly id?: unknown;
  readonly method?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonRpcMessage(value: unknown): value is JsonRpcEnvelope {
  return isRecord(value) && typeof value.method === 'string';
}

function hasRequestId(value: JsonRpcEnvelope): boolean {
  return Object.prototype.hasOwnProperty.call(value, 'id') && value.id !== null;
}

/**
 * MCP stdio transport.
 *
 * Messages are newline-delimited JSON, matching the MCP stdio framing. The
 * transport only attaches to the daemon's own streams when the daemon was
 * launched with `--stdio`.
 */
export class StdioMcpTransport implements IMcpTransport {
  public readonly kind = 'stdio' as const;

  private handler: McpMessageHandler | undefined;

  private buffer = '';

  private readonly onData: (chunk: Buffer) => void;

  private readonly input: NodeJS.ReadableStream;

  private readonly output: NodeJS.WritableStream;

  private closed = false;

  constructor(
    input: NodeJS.ReadableStream = process.stdin,
    output: NodeJS.WritableStream = process.stdout,
  ) {
    this.input = input;
    this.output = output;
    this.onData = (chunk: Buffer): void => {
      void this.consume(chunk);
    };
    this.input.on('data', this.onData);
    this.input.resume?.();
  }

  public onMessage(handler: (msg: unknown) => Promise<unknown>): void {
    this.handler = handler;
  }

  public sendNotification(msg: unknown): void {
    if (!this.closed) {
      this.write(msg);
    }
  }

  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.input.removeListener?.('data', this.onData);
  }

  private async consume(chunk: Buffer): Promise<void> {
    this.buffer += chunk.toString('utf8');

    for (;;) {
      const newlineIndex = this.buffer.indexOf('\n');

      if (newlineIndex === -1) {
        return;
      }

      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line.length === 0) {
        continue;
      }

      await this.dispatchLine(line);
    }
  }

  private async dispatchLine(line: string): Promise<void> {
    let message: unknown;

    try {
      message = JSON.parse(line) as unknown;
    } catch {
      return;
    }

    if (!isJsonRpcMessage(message)) {
      return;
    }

    const handler = this.handler;

    if (handler === undefined) {
      return;
    }

    const response = await handler(message);

    if (hasRequestId(message)) {
      this.write(response);
    }
  }

  private write(message: unknown): void {
    this.output.write(`${JSON.stringify(message)}\n`);
  }
}

/**
 * MCP loopback HTTP transport.
 *
 * Requests are JSON-RPC envelopes posted to `/mcp`. Requests with an `id`
 * receive the handler's resolved value as a JSON response; notifications are
 * acknowledged with `202 Accepted`. `sendNotification` fans out to any
 * connected event-stream clients.
 */
export class HttpMcpTransport implements IMcpTransport {
  public readonly kind = 'mcp-http' as const;

  public readonly address: string;

  private readonly server: Server;

  private readonly streams = new Set<ServerResponse>();

  private handler: McpMessageHandler | undefined;

  private closed = false;

  private constructor(server: Server, address: string) {
    this.server = server;
    this.address = address;
    this.server.on('request', (request, response) => {
      void this.handleRequest(request, response);
    });
  }

  /** Binds an ephemeral loopback listener. */
  public static async create(host: string = '127.0.0.1'): Promise<HttpMcpTransport> {
    const server = createServer();

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = (): void => {
        server.off('error', onError);
        resolve();
      };

      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(0, host);
    });

    const address = server.address();

    if (address === null || typeof address === 'string') {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      throw new Error('MCP HTTP transport did not bind a TCP address');
    }

    return new HttpMcpTransport(server, `http://${host}:${address.port}/mcp`);
  }

  public onMessage(handler: (msg: unknown) => Promise<unknown>): void {
    this.handler = handler;
  }

  public sendNotification(message: unknown): void {
    const payload = JSON.stringify(message);

    for (const stream of this.streams) {
      if (!stream.writableEnded) {
        stream.write(`data: ${payload}\n\n`);
      }
    }
  }

  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;

    for (const stream of this.streams) {
      stream.end();
    }

    this.streams.clear();

    await new Promise<void>((resolve) => {
      this.server.close(() => resolve());
    });
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method === 'GET') {
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      response.write(': connected\n\n');
      this.streams.add(response);
      response.on('close', () => {
        this.streams.delete(response);
      });

      return;
    }

    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'GET, POST' });
      response.end();

      return;
    }

    const body = await this.readBody(request);

    if (body === undefined) {
      response.writeHead(413);
      response.end();

      return;
    }

    let message: unknown;

    try {
      message = JSON.parse(body) as unknown;
    } catch {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));

      return;
    }

    if (!isJsonRpcMessage(message)) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } }));

      return;
    }

    const handler = this.handler;

    if (handler === undefined) {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id ?? null, error: { code: -32002, message: 'MCP handler is not attached' } }));

      return;
    }

    try {
      const result = await handler(message);

      if (!hasRequestId(message)) {
        response.writeHead(202);
        response.end();

        return;
      }

      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(result));
    } catch (error: unknown) {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        jsonrpc: '2.0',
        id: message.id ?? null,
        error: { code: -32603, message: error instanceof Error ? error.message : 'Internal error' },
      }));
    }
  }

  private readBody(request: IncomingMessage): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;

      request.on('data', (chunk: Buffer) => {
        size += chunk.byteLength;

        if (size > MAX_MCP_HTTP_BODY_BYTES) {
          resolve(undefined);
          request.destroy();
          return;
        }

        chunks.push(chunk);
      });
      request.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
      request.on('error', (error: Error) => {
        reject(error);
      });
    });
  }
}

/** Options for {@link attachMcpTransports}. */
export interface AttachMcpTransportsOptions {
  /** Whether the daemon was launched with `--stdio`. */
  readonly stdio: boolean;

  /** Diagnostic sink for skipped or failed attachments. */
  readonly logger?: {
    warn(message: string, meta?: Record<string, unknown>): void;
  };
}

async function writeEndpointFile(
  workspaceRoot: string,
  pluginId: string,
  address: string,
): Promise<void> {
  const directory = join(workspaceRoot, '.brud');
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(workspaceRoot, MCP_ENDPOINT_RELATIVE_PATH),
    JSON.stringify({ pluginId, transport: 'mcp-http', url: address }, null, 2),
    { encoding: 'utf8', mode: 0o600 },
  );
}

/**
 * Binds the MCP transports declared by every active plugin.
 *
 * This is deliberately MCP-specific, not a generic transport registry. It
 * resolves the plugin manager, inspects each active manifest, and hands one
 * {@link IMcpTransport} per declared kind to `plugin.onTransportAttach`.
 * The caller (the workspace registry) closes the returned transports before
 * shutting the kernel down.
 *
 * @param workspace - Booted workspace whose plugins may want a transport.
 * @param options - stdio opt-in and diagnostics.
 * @returns Every transport bound for this workspace.
 */
export async function attachMcpTransports(
  workspace: KernelWorkspace,
  options: AttachMcpTransportsOptions,
): Promise<readonly IMcpTransport[]> {
  const kernelModule = await loadKernelModule();
  const manager = workspace.kernel.requestAccess<IPluginManagerService>(
    {
      callerId: 'brud.daemon',
      tier: 'core',
      workspaceRoot: workspace.root,
    },
    kernelModule.PluginManagerToken,
  );
  const attached: IMcpTransport[] = [];
  let stdioClaimed = false;

  for (const record of manager.listPlugins()) {
    if (record.state !== 'active') {
      continue;
    }

    const requested = record.plugin.manifest.transports;

    if (requested === undefined || requested.length === 0) {
      continue;
    }

    const hook = record.plugin.onTransportAttach;

    if (typeof hook !== 'function') {
      options.logger?.warn('Plugin declares transports but has no onTransportAttach hook', {
        pluginId: record.plugin.manifest.id,
      });
      continue;
    }

    for (const kind of requested) {
      if (options.stdio && kind !== 'stdio') {
        options.logger?.warn('Skipping non-stdio MCP transport in --stdio mode', {
          pluginId: record.plugin.manifest.id,
          transport: kind,
        });
        continue;
      }

      if (kind === 'stdio') {
        if (!options.stdio) {
          options.logger?.warn('Skipping stdio MCP transport; daemon was not launched with --stdio', {
            pluginId: record.plugin.manifest.id,
          });
          continue;
        }

        if (stdioClaimed) {
          options.logger?.warn('Skipping additional stdio MCP transport; streams are already claimed', {
            pluginId: record.plugin.manifest.id,
          });
          continue;
        }

        const transport = new StdioMcpTransport();
        await hook.call(record.plugin, transport);
        attached.push(transport);
        stdioClaimed = true;
        continue;
      }

      try {
        const transport = await HttpMcpTransport.create();
        await writeEndpointFile(workspace.root, record.plugin.manifest.id, transport.address);
        await hook.call(record.plugin, transport);
        attached.push(transport);
      } catch (error: unknown) {
        options.logger?.warn('Failed to bind MCP HTTP transport', {
          pluginId: record.plugin.manifest.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return attached;
}