import { readFileSync } from 'node:fs';
import type { Socket } from 'node:net';

/** Identity the operating system reports for the other end of a local socket. */
export interface PeerCredentials {
  readonly pid: number;
  readonly uid: number;
  readonly gid: number;
}

/** The process the daemon was spawned by, captured once before the first accept. */
export interface ExpectedPeer {
  readonly pid: number;
  readonly uid: number;
  readonly startTime: string;
}

/**
 * Minimal shape of the prebuilt helper package.
 *
 * The package is ESM-only, so it is loaded with a dynamic import from this
 * CommonJS package. Only the two host primitives are used.
 */
interface PeerCredentialHost {
  readonly localPeerCredentials: (socket: Socket) => PeerCredentials;
  readonly processStartTime: (pid: number) => string | undefined;
}

export class PeerCredentialError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = 'PeerCredentialError';
    this.reason = reason;
  }
}

let hostPromise: Promise<PeerCredentialHost> | undefined;

/**
 * Loads the prebuilt peer-credential helper.
 *
 * `@cotal-ai/seat` is the package used for both platforms: its shipped
 * `peercred.node` reads `SO_PEERCRED` on Linux and `LOCAL_PEERCRED` plus
 * `LOCAL_PEERPID` on macOS. The package never compiles at install time.
 */
export async function loadPeerCredentialHost(): Promise<PeerCredentialHost> {
  hostPromise ??= import('@cotal-ai/seat').then((module) => {
    if (
      typeof module.localPeerCredentials !== 'function'
      || typeof module.processStartTime !== 'function'
    ) {
      throw new Error('The installed peer-credential helper does not expose the required primitives');
    }

    return {
      localPeerCredentials: module.localPeerCredentials,
      processStartTime: module.processStartTime,
    };
  });

  return await hostPromise;
}

function readLinuxStartTime(pid: number): string {
  let stat: string;
  let bootId: string;

  try {
    stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    bootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  } catch (error: unknown) {
    throw new PeerCredentialError(
      `cannot read the start time of process ${pid} from /proc: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // The command name is parenthesized and may contain spaces or parentheses.
  const closing = stat.lastIndexOf(')');

  if (closing === -1) {
    throw new PeerCredentialError(`cannot parse /proc/${pid}/stat`);
  }

  // Field 22 (starttime) is index 19 after the command name and state.
  const fields = stat.slice(closing + 2).trim().split(/\s+/);
  const startTicks = fields[19];

  if (startTicks === undefined || !/^\d+$/.test(startTicks)) {
    throw new PeerCredentialError(`cannot parse the start time of process ${pid}`);
  }

  return `linux:${bootId}:${startTicks}`;
}

function readDarwinStartTime(host: PeerCredentialHost, pid: number): string {
  let startTime: string | undefined;

  try {
    startTime = host.processStartTime(pid);
  } catch (error: unknown) {
    throw new PeerCredentialError(
      `cannot read the start time of process ${pid}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (startTime === undefined || startTime.length === 0) {
    throw new PeerCredentialError(`process ${pid} has no readable start time`);
  }

  return `darwin:${startTime}`;
}

/**
 * Reads a process start time in a form that can be compared across processes.
 *
 * Linux reads `/proc` (boot id plus the kernel start tick); macOS asks the
 * prebuilt helper. Both values survive a numeric PID reuse.
 */
export function readProcessStartTime(host: PeerCredentialHost, pid: number): string {
  if (process.platform === 'linux') {
    return readLinuxStartTime(pid);
  }

  if (process.platform === 'darwin') {
    return readDarwinStartTime(host, pid);
  }

  throw new PeerCredentialError(
    `peer-credential verification is not implemented on ${process.platform}`,
  );
}

/** Captures the expected peer before the daemon accepts any connection. */
export function captureExpectedPeer(host: PeerCredentialHost, pid: number): ExpectedPeer {
  const uid = typeof process.geteuid === 'function'
    ? process.geteuid()
    : typeof process.getuid === 'function'
      ? process.getuid()
      : undefined;

  if (uid === undefined) {
    throw new PeerCredentialError(
      `peer-credential verification requires process.geteuid() on ${process.platform}`,
    );
  }

  if (!Number.isInteger(pid) || pid <= 0) {
    throw new PeerCredentialError(`invalid expected peer pid ${String(pid)}`);
  }

  return {
    pid,
    uid,
    startTime: readProcessStartTime(host, pid),
  };
}

function assertCredentialShape(credentials: PeerCredentials): void {
  if (
    !Number.isInteger(credentials.pid)
    || credentials.pid <= 0
    || !Number.isInteger(credentials.uid)
    || credentials.uid < 0
    || !Number.isInteger(credentials.gid)
    || credentials.gid < 0
  ) {
    throw new PeerCredentialError(
      `the operating system returned an invalid peer credential ${JSON.stringify(credentials)}`,
    );
  }
}

/**
 * Verifies the connected process against the host that spawned the daemon.
 *
 * The check runs on the accepted socket, before the Noise handshake or any
 * dispatch work. A failure is final: the caller must close the connection.
 */
export function verifyPeerCredentials(
  socket: Socket,
  expected: ExpectedPeer,
  host: PeerCredentialHost,
): PeerCredentials {
  let credentials: PeerCredentials;

  try {
    credentials = host.localPeerCredentials(socket);
  } catch (error: unknown) {
    throw new PeerCredentialError(
      `the operating system did not expose the peer credentials: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  assertCredentialShape(credentials);

  if (credentials.uid !== expected.uid) {
    throw new PeerCredentialError(
      `peer uid ${credentials.uid} does not match the daemon uid ${expected.uid}`,
    );
  }

  if (credentials.pid !== expected.pid) {
    throw new PeerCredentialError(
      `peer pid ${credentials.pid} does not match the spawning host pid ${expected.pid}`,
    );
  }

  const peerStartTime = readProcessStartTime(host, credentials.pid);

  if (peerStartTime !== expected.startTime) {
    throw new PeerCredentialError(
      `peer pid ${credentials.pid} has start time "${peerStartTime}", but the spawning host started at "${expected.startTime}"`,
    );
  }

  return credentials;
}