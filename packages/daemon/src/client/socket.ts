import { readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import type { Socket } from 'node:net';
import type { DaemonCallerTier } from '@brud/protocol';
import type { DaemonEndpoint } from '../lifecycle/endpoint.js';
import {
  EndpointOwnershipError,
  verifyEndpointOwnership,
} from '../security/ownership.js';
import { DaemonConnectionError } from './errors.js';

export const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

export function normalizeTimeout(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError('Timeout must be a positive finite number');
  }

  return Math.max(1, Math.trunc(value));
}

/** Path of the pre-shared key that authenticates one caller principal. */
export function principalTokenPath(
  endpoint: DaemonEndpoint,
  principal: DaemonCallerTier,
): string {
  return principal === 'ai' ? endpoint.aiTokenPath : endpoint.tokenPath;
}

export async function readDaemonToken(
  endpoint: DaemonEndpoint,
  principal: DaemonCallerTier = 'ui',
): Promise<string> {
  const tokenPath = principalTokenPath(endpoint, principal);
  let token: string;

  try {
    token = (await readFile(tokenPath, 'utf8')).trim();
  } catch (error: unknown) {
    throw new DaemonConnectionError(
      `Unable to read daemon token at "${tokenPath}"`,
      { cause: error },
    );
  }

  if (token.length === 0) {
    throw new DaemonConnectionError(`Daemon token at "${tokenPath}" is empty`);
  }

  return token;
}

/**
 * Verifies the endpoint's on-disk ownership before opening a connection.
 *
 * On POSIX this refuses a socket owned by another user or reachable by group
 * or world. Windows named pipes report `unsupported`; the caller proceeds on
 * the platform's pipe ACL, which Node cannot inspect.
 */
async function assertEndpointOwnership(socketPath: string): Promise<void> {
  try {
    await verifyEndpointOwnership(socketPath);
  } catch (error: unknown) {
    if (error instanceof EndpointOwnershipError) {
      throw new DaemonConnectionError(error.message, { cause: error });
    }

    throw new DaemonConnectionError(
      `Cannot verify daemon endpoint ownership at "${socketPath}"`,
      { cause: error },
    );
  }
}

export async function connectSocket(
  socketPath: string,
  timeoutMs: number = DEFAULT_CONNECT_TIMEOUT_MS,
): Promise<Socket> {
  const timeout = normalizeTimeout(timeoutMs, DEFAULT_CONNECT_TIMEOUT_MS);

  await assertEndpointOwnership(socketPath);

  return new Promise<Socket>((resolve, reject) => {
    const socket = createConnection(socketPath);
    let settled = false;

    const finish = (): boolean => {
      if (settled) {
        return false;
      }

      settled = true;
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('error', onError);

      return true;
    };

    const onConnect = (): void => {
      if (!finish()) {
        return;
      }

      resolve(socket);
    };

    const onError = (error: Error): void => {
      if (!finish()) {
        return;
      }

      socket.destroy();
      reject(
        new DaemonConnectionError(`Cannot connect to daemon socket at "${socketPath}"`, {
          cause: error,
        }),
      );
    };

    const timer = setTimeout(() => {
      if (!finish()) {
        return;
      }

      socket.destroy();
      reject(
        new DaemonConnectionError(
          `Timed out connecting to daemon socket at "${socketPath}" after ${timeout} ms`,
        ),
      );
    }, timeout);

    timer.unref?.();

    socket.once('connect', onConnect);
    socket.once('error', onError);
  });
}