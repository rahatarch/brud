import * as http from 'http';
import type { IncomingMessage, ServerResponse } from 'http';
import { bootMcpWorkspace } from './bootstrap';
import { createBrudMcpServer, DEFAULT_SERVER_IDENTITY } from './server';
import { createConcurrencyLimiter } from './limits';
import type { ServerIdentity } from './server';

export interface HttpServerOptions {
  readonly port?: number;
  readonly host?: string;
  readonly path?: string;
  readonly executionTimeoutMs?: number;
  readonly identity?: ServerIdentity;
  readonly maxConcurrentRequests?: number;
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
const DEFAULT_MAX_CONCURRENT = 8;

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
  const limiter = createConcurrencyLimiter(options.maxConcurrentRequests ?? DEFAULT_MAX_CONCURRENT);

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

    if (!limiter.tryAcquire()) {
      writeProtocolError(res, 429, -32000, 'Too many concurrent requests.');
      return;
    }

    const controller = new AbortController();
    let released = false;
    const releaseOnce = () => {
      if (released) {
        return;
      }
      released = true;
      limiter.release();
    };
    let finished = false;

    let server: Awaited<ReturnType<typeof createBrudMcpServer>> | undefined;
    try {
      const { StreamableHTTPServerTransport } = await import(
        '@modelcontextprotocol/sdk/server/streamableHttp.js'
      );
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      server = await createBrudMcpServer(workspace, identity, {
        signal: controller.signal,
        executionTimeoutMs: timeoutMs,
        onExecutionSettled: releaseOnce,
      });

      res.on('close', () => {
        if (!finished) {
          controller.abort();
        }
        void transport.close().catch(() => undefined);
        void server?.close().catch(() => undefined);
      });

      await server.connect(transport);
      await transport.handleRequest(req, res);
      finished = true;
    } catch {
      if (!res.headersSent) {
        writeProtocolError(res, 500, -32603, 'Internal server error');
      }
    } finally {
      releaseOnce();
    }
  }

  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      httpServer.removeListener('listening', onListening);
      if (error.code === 'EADDRINUSE') {
        const failure = new Error(
          `Port ${options.port} is already in use.`,
        ) as NodeJS.ErrnoException;
        failure.code = 'EADDRINUSE';
        reject(failure);
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
