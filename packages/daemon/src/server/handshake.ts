import { realpathSync } from 'node:fs';
import { isAbsolute, posix, resolve, sep, win32 } from 'node:path';
import * as Protocol from '@brud/protocol';
import type {
  DaemonClientIdentity,
  DaemonConnectParams,
  RpcErrorCode,
  RpcErrorDetails,
} from '@brud/protocol';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalizePath(input: string): string {
  const resolved = resolve(input);
  let canonical = resolved;

  try {
    canonical = realpathSync.native(resolved);
  } catch {
    canonical = resolved;
  }

  if (canonical.length > 1 && canonical.endsWith(sep)) {
    canonical = canonical.slice(0, -1);
  }

  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

export function canonicalizeWorkspaceRoot(input: string): string {
  return canonicalizePath(input);
}

/**
 * Host directories that must never become a workspace root.
 *
 * These are compared exactly against the realpath-resolved root. Descendants
 * are intentionally not rejected: on macOS, `/private` contains the per-user
 * temporary roots, and developers legitimately keep projects below paths such
 * as `/usr/local/src`. A root that *is* a system directory or the filesystem
 * root is always a rogue attachment.
 */
const POSIX_SYSTEM_ROOTS: readonly string[] = [
  '/etc',
  '/usr',
  '/bin',
  '/sbin',
  '/var',
  '/sys',
  '/proc',
  '/dev',
  '/boot',
  '/private',
];

const WINDOWS_SYSTEM_ROOTS: readonly string[] = [
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\ProgramData',
];

function rootComparisonKey(value: string): string {
  const trimmed = value.length > 1 && /[\\/]$/u.test(value) ? value.slice(0, -1) : value;

  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
}

/**
 * Reports whether a canonical root is the host filesystem root or a known
 * system directory.
 */
export function isDeniedWorkspaceRoot(canonicalRoot: string): boolean {
  const api = process.platform === 'win32' ? win32 : posix;
  const key = rootComparisonKey(canonicalRoot);

  if (key === rootComparisonKey(api.parse(canonicalRoot).root)) {
    return true;
  }

  const denied = process.platform === 'win32' ? WINDOWS_SYSTEM_ROOTS : POSIX_SYSTEM_ROOTS;

  return denied.some((entry) => rootComparisonKey(entry) === key);
}

export interface HandshakeFailure {
  readonly ok: false;
  readonly code: RpcErrorCode;
  readonly message: string;
  readonly data?: RpcErrorDetails;
}

export interface WorkspaceScopeSuccess {
  readonly ok: true;
  readonly workspaceRoot: string;
}

export type WorkspaceScopeOutcome = WorkspaceScopeSuccess | HandshakeFailure;

function failure(
  code: RpcErrorCode,
  message: string,
  data?: RpcErrorDetails,
): HandshakeFailure {
  return data === undefined ? { ok: false, code, message } : { ok: false, code, message, data };
}

export interface WorkspaceScopeOptions {
  /** Canonical root the daemon was configured with. */
  readonly primaryRoot: string;
  /** True for single-kernel compositions that serve only `primaryRoot`. */
  readonly enforcePrimary: boolean;
}

/**
 * Validates the workspace root claimed inside the authenticated Noise payload.
 *
 * This runs at the daemon's secure accept boundary, before any JSON-RPC
 * dispatch, so a caller cannot widen its scope with a later request.
 */
export function validateAuthenticatedWorkspaceRoot(
  value: unknown,
  options: WorkspaceScopeOptions,
): WorkspaceScopeOutcome {
  if (typeof value !== 'string') {
    return failure(Protocol.INVALID_PARAMS, 'Handshake workspaceRoot must be a string');
  }

  if (!isAbsolute(value)) {
    return failure(
      Protocol.INVALID_PARAMS,
      'Handshake workspaceRoot must be an absolute path',
      { errorCode: 'INVALID_WORKSPACE_ROOT', path: value },
    );
  }

  const lexicalRoot = resolve(value);
  const candidateRoot = canonicalizeWorkspaceRoot(value);

  if (isDeniedWorkspaceRoot(lexicalRoot) || isDeniedWorkspaceRoot(candidateRoot)) {
    return failure(
      Protocol.INVALID_PARAMS,
      'ROGUE WORKSPACE ROOT REJECTED (INVALID_WORKSPACE_ROOT): the filesystem root or a system directory cannot be a workspace',
      { errorCode: 'INVALID_WORKSPACE_ROOT', path: candidateRoot },
    );
  }

  if (options.enforcePrimary && candidateRoot !== options.primaryRoot) {
    return failure(
      Protocol.WORKSPACE_MISMATCH,
      'Workspace root does not match the daemon workspace',
      {
        expected: options.primaryRoot,
        actual: candidateRoot,
      },
    );
  }

  return { ok: true, workspaceRoot: candidateRoot };
}

function parseClientIdentity(value: unknown): DaemonClientIdentity | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const name = value.name;
  const version = value.version;

  if (typeof name !== 'string' || typeof version !== 'string') {
    return undefined;
  }

  return { name, version };
}

export interface ConnectSuccess {
  readonly ok: true;
  readonly params: DaemonConnectParams;
}

export type ConnectOutcome = ConnectSuccess | HandshakeFailure;

/**
 * Validates the post-handshake `daemon.connect` payload.
 *
 * Identity, principal, and scope were authenticated by the Noise session
 * before this method ran. This validator only checks the protocol version and
 * the optional presentation fields; it never accepts a token, tier, or scope.
 */
export class ConnectValidator {
  validate(value: unknown): ConnectOutcome {
    if (!isRecord(value)) {
      return failure(Protocol.INVALID_PARAMS, 'daemon.connect requires a params object');
    }

    const protocolVersion = value.protocolVersion;

    if (typeof protocolVersion !== 'string') {
      return failure(Protocol.INVALID_PARAMS, 'protocolVersion must be a string');
    }

    if (protocolVersion !== Protocol.DAEMON_PROTOCOL_VERSION) {
      return failure(
        Protocol.PROTOCOL_VERSION_MISMATCH,
        'Unsupported daemon protocol version',
        {
          expected: Protocol.DAEMON_PROTOCOL_VERSION,
          actual: protocolVersion,
        },
      );
    }

    const clientInfo = parseClientIdentity(value.clientInfo);
    const client = parseClientIdentity(value.client);
    const capabilities = Array.isArray(value.capabilities)
      ? value.capabilities.filter((entry): entry is string => typeof entry === 'string')
      : undefined;

    return {
      ok: true,
      params: {
        protocolVersion,
        ...(client === undefined ? {} : { client }),
        ...(clientInfo === undefined ? {} : { clientInfo }),
        ...(capabilities === undefined ? {} : { capabilities }),
      },
    };
  }
}