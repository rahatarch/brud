import * as Protocol from '@brud/protocol';
import type { DaemonClientIdentity } from '@brud/protocol';
import {
  canonicalizeDaemonWorkspaceRoot,
  resolveEndpoint,
} from '../lifecycle/endpoint.js';
import type { DaemonEndpoint } from '../lifecycle/endpoint.js';
import { DaemonClient } from './DaemonClient.js';
import {
  DaemonConnectionError,
  DaemonDisconnectedError,
  DaemonNotRunningError,
  DaemonRequestTimeoutError,
  DaemonStartupTimeoutError,
} from './errors.js';
import {
  DAEMON_CLIENT_CAPABILITIES,
  DAEMON_CLIENT_NAME,
  DAEMON_CLIENT_VERSION,
} from './identity.js';
import { DEFAULT_SPAWN_TIMEOUT_MS, spawnDaemon } from './spawn.js';
import {
  connectSocket,
  DEFAULT_CONNECT_TIMEOUT_MS,
  normalizeTimeout,
  readDaemonToken,
} from './socket.js';

export const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5_000;

export interface ConnectDaemonOptions {
  readonly workspaceRoot: string;
  readonly spawnIfMissing?: boolean;
  readonly timeoutMs?: number;
  readonly handshakeTimeoutMs?: number;
  readonly connectTimeoutMs?: number;
  readonly client?: DaemonClientIdentity;
  readonly clientInfo?: DaemonClientIdentity;
  readonly capabilities?: readonly string[];
}

function delay(durationMs: number): Promise<void> {
  return new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, durationMs);
  });
}

function isUnavailable(error: unknown): boolean {
  return error instanceof DaemonConnectionError
    || error instanceof DaemonDisconnectedError
    || error instanceof DaemonRequestTimeoutError;
}

async function openClient(
  endpoint: DaemonEndpoint,
  options: ConnectDaemonOptions,
  connectTimeoutMs: number,
  handshakeTimeoutMs: number,
): Promise<DaemonClient> {
  const token = await readDaemonToken(endpoint);
  const socket = await connectSocket(endpoint.socketPath, connectTimeoutMs);
  const client = new DaemonClient(socket);

  try {
    await client.connect(
      {
        protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
        token,
        workspaceRoot: endpoint.workspaceRoot,
        client: options.clientInfo
          ?? options.client
          ?? { name: DAEMON_CLIENT_NAME, version: DAEMON_CLIENT_VERSION },
        capabilities: options.capabilities ?? DAEMON_CLIENT_CAPABILITIES,
      },
      { timeoutMs: handshakeTimeoutMs },
    );
  } catch (error: unknown) {
    await client.close();
    throw error;
  }

  return client;
}

async function openClientWithRetry(
  endpoint: DaemonEndpoint,
  options: ConnectDaemonOptions,
  connectTimeoutMs: number,
  handshakeTimeoutMs: number,
  timeoutMs: number,
): Promise<DaemonClient> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  for (;;) {
    try {
      return await openClient(endpoint, options, connectTimeoutMs, handshakeTimeoutMs);
    } catch (error: unknown) {
      if (!isUnavailable(error)) {
        throw error;
      }

      lastError = error;
    }

    const remaining = deadline - Date.now();

    if (remaining <= 0) {
      break;
    }

    await delay(Math.min(50, remaining));
  }

  throw new DaemonStartupTimeoutError({
    workspaceRoot: endpoint.workspaceRoot,
    timeoutMs,
    cause: lastError,
  });
}

export async function connectToDaemon(options: ConnectDaemonOptions): Promise<DaemonClient> {
  const canonicalRoot = await canonicalizeDaemonWorkspaceRoot(options.workspaceRoot);
  const endpoint = await resolveEndpoint(canonicalRoot);
  const timeoutMs = normalizeTimeout(options.timeoutMs, DEFAULT_SPAWN_TIMEOUT_MS);
  const connectTimeoutMs = normalizeTimeout(
    options.connectTimeoutMs,
    Math.min(DEFAULT_CONNECT_TIMEOUT_MS, timeoutMs),
  );
  const handshakeTimeoutMs = normalizeTimeout(
    options.handshakeTimeoutMs,
    DEFAULT_HANDSHAKE_TIMEOUT_MS,
  );

  try {
    return await openClient(endpoint, options, connectTimeoutMs, handshakeTimeoutMs);
  } catch (error: unknown) {
    if (!isUnavailable(error)) {
      throw error;
    }

    if (options.spawnIfMissing === false) {
      throw new DaemonNotRunningError({
        workspaceRoot: endpoint.workspaceRoot,
        socketPath: endpoint.socketPath,
        cause: error,
      });
    }

    await spawnDaemon(endpoint.workspaceRoot, { timeoutMs });

    return openClientWithRetry(
      endpoint,
      options,
      connectTimeoutMs,
      handshakeTimeoutMs,
      timeoutMs,
    );
  }
}
