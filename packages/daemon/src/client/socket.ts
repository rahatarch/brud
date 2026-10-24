import { readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import type { Socket } from 'node:net';
import type { DaemonEndpoint } from '../lifecycle/endpoint.js';
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

export async function readDaemonToken(endpoint: DaemonEndpoint): Promise<string> {
  let token: string;

  try {
    token = (await readFile(endpoint.tokenPath, 'utf8')).trim();
  } catch (error: unknown) {
    throw new DaemonConnectionError(
      `Unable to read daemon token at "${endpoint.tokenPath}"`,
      { cause: error },
    );
  }

  if (token.length === 0) {
    throw new DaemonConnectionError(`Daemon token at "${endpoint.tokenPath}" is empty`);
  }

  return token;
}

export function connectSocket(
  socketPath: string,
  timeoutMs: number = DEFAULT_CONNECT_TIMEOUT_MS,
): Promise<Socket> {
  const timeout = normalizeTimeout(timeoutMs, DEFAULT_CONNECT_TIMEOUT_MS);

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
