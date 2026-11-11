import { readFileSync } from 'node:fs';
import type { Socket } from 'node:net';

/** Identity the operating system reports for the other end of a local socket. */
export interface PeerCredentials {
  readonly pid: number;
  readonly uid: number;
  readonly gid: number;
}

/**
 * Identity the Windows named-pipe transport reports for the connecting process.
 *
 * `user` is the process token's user SID and `birth` is its creation time in
 * 100 ns units since 1601 (the same decimal FILETIME string the helper returns
 * from `processStartTime`). All three values are read through one process
 * handle, so they describe the same process even after PID reuse.
 */
export interface WindowsPeerIdentity {
  readonly pid: number;
  readonly user: string;
  readonly birth: string;
}

/** A connection the Windows helper authenticated; `fd` is a libuv descriptor. */
export interface PipePeer extends WindowsPeerIdentity {
  readonly fd: number;
}

/** A connection the Windows helper dropped unread because identity was unavailable. */
export interface PipeRefused {
  readonly refused: string;
  readonly pid: number;
}

/** Windows named-pipe listener created by the prebuilt helper. */
export interface PipeListener {
  accept(): Promise<PipePeer | PipeRefused>;
  close(): void;
}

/** The process the daemon was spawned by, captured once before the first accept. */
export interface ExpectedPeer {
  readonly pid: number;
  /** POSIX effective uid. Absent on Windows, where `userSid` is used instead. */
  readonly uid?: number;
  /** Windows token user SID. Absent on POSIX. */
  readonly userSid?: string;
  readonly startTime: string;
}

/**
 * Minimal shape of the prebuilt helper package.
 *
 * The package is ESM-only, so it is loaded with a dynamic import from this
 * CommonJS package. The Windows-only primitives are optional here and are
 * required by the Windows code path; the POSIX path uses the first two.
 */
interface PeerCredentialHost {
  readonly localPeerCredentials: (socket: Socket) => PeerCredentials;
  readonly processStartTime: (pid: number) => string | undefined;
  readonly windowsUserSid?: () => string;
  readonly listenPipe?: (name: string) => PipeListener;
  readonly connectPipe?: (name: string, timeoutMs: number) => Promise<PipePeer>;
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
      ...(typeof module.windowsUserSid === 'function'
        ? { windowsUserSid: module.windowsUserSid }
        : {}),
      ...(typeof module.listenPipe === 'function'
        ? { listenPipe: module.listenPipe }
        : {}),
      ...(typeof module.connectPipe === 'function'
        ? { connectPipe: module.connectPipe }
        : {}),
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

function readWindowsStartTime(host: PeerCredentialHost, pid: number): string {
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

  return `win32:${startTime}`;
}

/**
 * Reads a process start time in a form that can be compared across processes.
 *
 * Linux reads `/proc` (boot id plus the kernel start tick); macOS and Windows
 * ask the prebuilt helper for the kernel process creation time. Every value
 * survives a numeric PID reuse.
 */
export function readProcessStartTime(host: PeerCredentialHost, pid: number): string {
  if (process.platform === 'linux') {
    return readLinuxStartTime(pid);
  }

  if (process.platform === 'darwin') {
    return readDarwinStartTime(host, pid);
  }

  if (process.platform === 'win32') {
    return readWindowsStartTime(host, pid);
  }

  throw new PeerCredentialError(
    `peer-credential verification is not implemented on ${process.platform}`,
  );
}

function readWindowsUserSid(host: PeerCredentialHost): string {
  if (typeof host.windowsUserSid !== 'function') {
    throw new PeerCredentialError(
      'the installed peer-credential helper does not expose windowsUserSid',
    );
  }

  let userSid: string;

  try {
    userSid = host.windowsUserSid();
  } catch (error: unknown) {
    throw new PeerCredentialError(
      `cannot read this process's Windows user SID: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (typeof userSid !== 'string' || userSid.length === 0) {
    throw new PeerCredentialError('the operating system returned an empty Windows user SID');
  }

  return userSid;
}

/** Captures the expected peer before the daemon accepts any connection. */
export function captureExpectedPeer(host: PeerCredentialHost, pid: number): ExpectedPeer {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new PeerCredentialError(`invalid expected peer pid ${String(pid)}`);
  }

  if (process.platform === 'win32') {
    return {
      pid,
      userSid: readWindowsUserSid(host),
      startTime: readProcessStartTime(host, pid),
    };
  }

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

  const expectedUid = expected.uid;

  if (expectedUid === undefined) {
    throw new PeerCredentialError('the expected peer has no captured POSIX uid');
  }

  if (credentials.uid !== expectedUid) {
    throw new PeerCredentialError(
      `peer uid ${credentials.uid} does not match the daemon uid ${expectedUid}`,
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

/**
 * Distinguishes an authenticated Windows pipe client from one the helper dropped.
 *
 * The helper only returns `fd` for a connection whose process identity it read;
 * a `refused` result was already closed unread and must never be admitted.
 */
export function isPipePeer(value: PipePeer | PipeRefused): value is PipePeer {
  return typeof (value as PipePeer).fd === 'number';
}

/**
 * Verifies the Windows named-pipe client against the host that spawned the daemon.
 *
 * The helper reports the connecting process's PID, token user SID, and creation
 * time from one process handle at accept. The check is process-level: another
 * process of the same user has the same SID but a different PID (and usually a
 * different creation time), so it is refused before the Noise handshake or any
 * dispatch work.
 */
export function verifyWindowsPeer(
  peer: WindowsPeerIdentity,
  expected: ExpectedPeer,
): WindowsPeerIdentity {
  if (
    !Number.isInteger(peer.pid)
    || peer.pid <= 0
    || typeof peer.user !== 'string'
    || peer.user.length === 0
    || typeof peer.birth !== 'string'
    || !/^\d+$/.test(peer.birth)
  ) {
    throw new PeerCredentialError(
      `the operating system returned an invalid peer identity ${JSON.stringify(peer)}`,
    );
  }

  const expectedSid = expected.userSid;

  if (typeof expectedSid !== 'string' || expectedSid.length === 0) {
    throw new PeerCredentialError('the daemon has no captured Windows user SID');
  }

  if (peer.user !== expectedSid) {
    throw new PeerCredentialError(
      `peer user SID ${peer.user} does not match the daemon user SID ${expectedSid}`,
    );
  }

  if (peer.pid !== expected.pid) {
    throw new PeerCredentialError(
      `peer pid ${peer.pid} does not match the spawning host pid ${expected.pid}`,
    );
  }

  const peerStartTime = `win32:${peer.birth}`;

  if (peerStartTime !== expected.startTime) {
    throw new PeerCredentialError(
      `peer pid ${peer.pid} has start time "${peerStartTime}", but the spawning host started at "${expected.startTime}"`,
    );
  }

  return peer;
}