import { spawn } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import * as Protocol from '@brud/protocol';
import { resolveEndpoint } from '../lifecycle/endpoint.js';
import type { DaemonEndpoint } from '../lifecycle/endpoint.js';
import { DaemonClient } from './DaemonClient.js';
import {
  DaemonConnectionError,
  DaemonSpawnError,
  DaemonStartupTimeoutError,
} from './errors.js';
import {
  DAEMON_CLIENT_CAPABILITIES,
  DAEMON_CLIENT_NAME,
  DAEMON_CLIENT_VERSION,
} from './identity.js';
import { connectSocket, normalizeTimeout, readDaemonToken } from './socket.js';

export const DEFAULT_SPAWN_TIMEOUT_MS = 5_000;

export const READINESS_POLL_INTERVAL_MS = 50;

const PROBE_ATTEMPT_TIMEOUT_MS = 1_000;

export interface SpawnDaemonOptions {
  readonly timeoutMs?: number;
}

function delay(durationMs: number): Promise<void> {
  return new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, durationMs);
  });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveDaemonCliPath(): Promise<string> {
  const candidates = [
    resolve(__dirname, '..', 'cli.js'),
    resolve(__dirname, '..', '..', 'dist', 'cli.js'),
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  throw new DaemonSpawnError(
    `Cannot locate daemon CLI. Looked in: ${candidates.join(', ')}`,
  );
}

async function readReadyMetadata(endpoint: DaemonEndpoint): Promise<void> {
  let content: string;

  try {
    content = await readFile(endpoint.metaPath, 'utf8');
  } catch (error: unknown) {
    throw new DaemonConnectionError(
      `Daemon metadata at "${endpoint.metaPath}" is not available`,
      { cause: error },
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch (error: unknown) {
    throw new DaemonConnectionError(
      `Daemon metadata at "${endpoint.metaPath}" is not valid JSON`,
      { cause: error },
    );
  }

  if (typeof parsed !== 'object' || parsed === null || !('socketPath' in parsed)) {
    throw new DaemonConnectionError(
      `Daemon metadata at "${endpoint.metaPath}" is malformed`,
    );
  }

  const socketPath = parsed.socketPath;

  if (socketPath !== endpoint.socketPath) {
    throw new DaemonConnectionError(
      `Daemon metadata socket path does not match "${endpoint.socketPath}"`,
    );
  }
}

async function probeDaemonReadiness(
  endpoint: DaemonEndpoint,
  timeoutMs: number,
): Promise<void> {
  await readReadyMetadata(endpoint);

  const token = await readDaemonToken(endpoint);
  const socket = await connectSocket(endpoint.socketPath, timeoutMs);
  const client = new DaemonClient(socket);

  try {
    await client.connect(
      {
        protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
        token,
        workspaceRoot: endpoint.workspaceRoot,
        client: { name: DAEMON_CLIENT_NAME, version: DAEMON_CLIENT_VERSION },
        capabilities: [...DAEMON_CLIENT_CAPABILITIES],
      },
      { timeoutMs },
    );
  } finally {
    await client.close();
  }
}

export async function spawnDaemon(
  workspaceRoot: string,
  options?: SpawnDaemonOptions,
): Promise<void> {
  const timeoutMs = normalizeTimeout(options?.timeoutMs, DEFAULT_SPAWN_TIMEOUT_MS);
  const endpoint = await resolveEndpoint(workspaceRoot);
  const cliPath = await resolveDaemonCliPath();

  const child = spawn(process.execPath, [cliPath, '--workspace', endpoint.workspaceRoot], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, BRUD_DAEMON_WORKSPACE: endpoint.workspaceRoot },
  });

  let spawnError: Error | undefined;

  child.once('error', (error: Error) => {
    spawnError = error;
  });
  child.unref();

  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  for (;;) {
    if (spawnError !== undefined) {
      throw new DaemonSpawnError(
        `Failed to spawn daemon for workspace "${endpoint.workspaceRoot}"`,
        { cause: spawnError },
      );
    }

    const remaining = deadline - Date.now();
    const attemptTimeout = Math.max(1, Math.min(PROBE_ATTEMPT_TIMEOUT_MS, remaining));

    try {
      await probeDaemonReadiness(endpoint, attemptTimeout);
      return;
    } catch (error: unknown) {
      lastError = error;
    }

    const remainingAfterProbe = deadline - Date.now();

    if (remainingAfterProbe <= 0) {
      break;
    }

    await delay(Math.min(READINESS_POLL_INTERVAL_MS, remainingAfterProbe));
  }

  throw new DaemonStartupTimeoutError({
    workspaceRoot: endpoint.workspaceRoot,
    timeoutMs,
    cause: lastError,
  });
}
