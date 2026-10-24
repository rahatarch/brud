import { createHash } from 'node:crypto';
import { chmod, mkdir, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const HASH_LENGTH = 24;
const MAX_SOCKET_PATH_BYTES = 100;
const RUNTIME_DIRECTORY_MODE = 0o700;

export interface DaemonEndpoint {
  readonly workspaceRoot: string;
  readonly workspaceHash: string;
  readonly runtimeDir: string;
  readonly socketPath: string;
  readonly lockPath: string;
  readonly tokenPath: string;
  readonly metaPath: string;
  readonly isWindows: boolean;
}

export class EndpointResolutionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EndpointResolutionError';
  }
}

function readEnvironmentValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function currentUid(): number | undefined {
  return typeof process.getuid === 'function' ? process.getuid() : undefined;
}

export function hashWorkspaceRoot(canonicalRoot: string): string {
  return createHash('sha256').update(canonicalRoot).digest('hex').slice(0, HASH_LENGTH);
}

export async function canonicalizeDaemonWorkspaceRoot(workspaceRoot: string): Promise<string> {
  const requested = resolve(workspaceRoot);

  try {
    const canonical = await realpath(requested);
    return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
  } catch (error: unknown) {
    throw new EndpointResolutionError(
      `Cannot resolve workspace root "${workspaceRoot}"`,
      { cause: error },
    );
  }
}

async function ensurePosixRuntimeDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: RUNTIME_DIRECTORY_MODE });

  try {
    await chmod(directory, RUNTIME_DIRECTORY_MODE);
  } catch {
    // Ownership validation below produces a precise error when this fails.
  }

  const info = await stat(directory);
  const uid = currentUid();

  if (uid !== undefined && info.uid !== uid) {
    throw new EndpointResolutionError(
      `Runtime directory "${directory}" is owned by uid ${info.uid}, expected ${uid}`,
    );
  }

  if ((info.mode & 0o077) !== 0) {
    throw new EndpointResolutionError(
      `Runtime directory "${directory}" has insecure mode ${(info.mode & 0o777).toString(8)}`,
    );
  }
}

async function ensureWindowsRuntimeDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
}

function posixRuntimeDirectory(): string {
  const configured = readEnvironmentValue('BRUD_DAEMON_RUNTIME_DIR');

  if (configured !== undefined) {
    return configured;
  }

  const xdgRuntimeDirectory = readEnvironmentValue('XDG_RUNTIME_DIR');

  if (xdgRuntimeDirectory !== undefined) {
    return join(xdgRuntimeDirectory, 'brud');
  }

  return join(tmpdir(), `brud-${currentUid() ?? 'default'}`);
}

function windowsRuntimeDirectory(): string {
  const localAppData = readEnvironmentValue('LOCALAPPDATA');
  return localAppData === undefined
    ? join(tmpdir(), 'brud')
    : join(localAppData, 'Brud', 'runtime');
}

function derivePosixSocketPath(runtimeDir: string, hash: string): string {
  const preferred = join(runtimeDir, `d-${hash}.sock`);

  if (Buffer.byteLength(preferred) < MAX_SOCKET_PATH_BYTES) {
    return preferred;
  }

  const fallback = join(tmpdir(), `b-${hash}.sock`);

  if (Buffer.byteLength(fallback) >= MAX_SOCKET_PATH_BYTES) {
    throw new EndpointResolutionError(
      `Daemon socket path "${fallback}" exceeds ${MAX_SOCKET_PATH_BYTES} bytes`,
    );
  }

  return fallback;
}

export async function resolveEndpoint(workspaceRoot: string): Promise<DaemonEndpoint> {
  const canonicalRoot = await canonicalizeDaemonWorkspaceRoot(workspaceRoot);
  const workspaceHash = hashWorkspaceRoot(canonicalRoot);
  const isWindows = process.platform === 'win32';

  if (isWindows) {
    const runtimeDir = windowsRuntimeDirectory();
    await ensureWindowsRuntimeDirectory(runtimeDir);

    return {
      workspaceRoot: canonicalRoot,
      workspaceHash,
      runtimeDir,
      socketPath: `\\\\.\\pipe\\brud-${workspaceHash}`,
      lockPath: join(runtimeDir, `d-${workspaceHash}.lock`),
      tokenPath: join(runtimeDir, `d-${workspaceHash}.token`),
      metaPath: join(runtimeDir, `d-${workspaceHash}.json`),
      isWindows,
    };
  }

  const runtimeDir = posixRuntimeDirectory();
  await ensurePosixRuntimeDirectory(runtimeDir);

  return {
    workspaceRoot: canonicalRoot,
    workspaceHash,
    runtimeDir,
    socketPath: derivePosixSocketPath(runtimeDir, workspaceHash),
    lockPath: join(runtimeDir, `d-${workspaceHash}.lock`),
    tokenPath: join(runtimeDir, `d-${workspaceHash}.token`),
    metaPath: join(runtimeDir, `d-${workspaceHash}.json`),
    isWindows,
  };
}
