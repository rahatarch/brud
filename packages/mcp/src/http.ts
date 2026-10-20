import * as http from 'http';
import type { IncomingMessage, ServerResponse } from 'http';
import { bootMcpWorkspace } from './bootstrap';
import { createBrudMcpServer, DEFAULT_SERVER_IDENTITY } from './server';
import type { ServerIdentity } from './server';

export interface HttpServerOptions {
  readonly port?: number;
  readonly host?: string;
  readonly path?: string;
  readonly executionTimeoutMs?: number;
  readonly identity?: ServerIdentity;
}

export interface StartedHttpServer {
  readonly port: number;
  readonly host: string;
  readonly path: string;
  readonly url: string;
  readonly workspaceRoot: string;
  refreshSettings(): void;
  close(): Promise<void>;
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PATH = '/mcp';
const DEFAULT_TIMEOUT_MS = 120_000;

function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) {
    return;
  }
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function writeProtocolError(res: ServerResponse, status: number, code: number, message: string): void {
  writeJson(res, status, { jsonrpc: '2.0', error: { code, message }, id: null });
}

export async function startHttpServer(
  workspaceCandidate: string,
  options: HttpServerOptions = {},
): Promise<StartedHttpServer> {
  const host = options.host ?? DEFAULT_HOST;
  if (!isLoopback(host)) {
    throw new Error(
      `Refusing to bind ${host}: only loopback interfaces are supported by default.`,
    );
  }

  const requestPath = options.path ?? DEFAULT_PATH;
  const timeoutMs = options.executionTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const identity = options.identity ?? DEFAULT_SERVER_IDENTITY;

  const workspace = await bootMcpWorkspace(workspaceCandidate);

  const httpServer = http.createServer((req, res) => {
    void handleRequest(req, res);
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const pathname = new URL(req.url ?? '/', `http://${host}`).pathname;
    if (pathname !== requestPath) {
      writeJson(res, 404, { error: 'Not found' });
      return;
    }
    if (req.method !== 'POST' && req.method !== 'GET' && req.method !== 'DELETE') {
      writeJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let server: Awaited<ReturnType<typeof createBrudMcpServer>> | undefined;
    try {
      const { StreamableHTTPServerTransport } = await import(
        '@modelcontextprotocol/sdk/server/streamableHttp.js'
      );
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      server = await createBrudMcpServer(workspace, identity, { signal: controller.signal });

      res.on('close', () => {
        clearTimeout(timer);
        void transport.close().catch(() => undefined);
        void server?.close().catch(() => undefined);
      });

      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch {
      if (!res.headersSent) {
        writeProtocolError(res, 500, -32603, 'Internal server error');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      httpServer.removeListener('listening', onListening);
      if (error.code === 'EADDRINUSE') {
        reject(new Error(`Port ${options.port} is already in use.`));
        return;
      }
      reject(error);
    };
    const onListening = () => {
      httpServer.removeListener('error', onError);
      resolve();
    };
    httpServer.once('error', onError);
    httpServer.once('listening', onListening);
    httpServer.listen(options.port ?? 0, host);
  });

  const address = httpServer.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    throw new Error('Failed to determine the bound port.');
  }

  return {
    port: address.port,
    host,
    path: requestPath,
    url: `http://${host}:${address.port}${requestPath}`,
    workspaceRoot: workspace.workspaceRoot,
    refreshSettings: () => workspace.refreshSettings(),
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}
