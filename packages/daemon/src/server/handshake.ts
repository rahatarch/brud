import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
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

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function canonicalizePath(input: string): string {
  const resolved = resolve(input);
  let canonical = resolved;

  try {
    if (existsSync(resolved)) {
      canonical = realpathSync.native(resolved);
    }
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

export interface HandshakeFailure {
  readonly ok: false;
  readonly code: RpcErrorCode;
  readonly message: string;
  readonly data?: RpcErrorDetails;
}

export interface HandshakeSuccess {
  readonly ok: true;
  readonly params: DaemonConnectParams;
}

export type HandshakeOutcome = HandshakeSuccess | HandshakeFailure;

export interface HandshakeConfig {
  readonly token: string;
  readonly workspaceRoot: string;
}

function failure(
  code: RpcErrorCode,
  message: string,
  data?: RpcErrorDetails,
): HandshakeFailure {
  return data === undefined ? { ok: false, code, message } : { ok: false, code, message, data };
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

export class HandshakeValidator {
  private readonly expectedTokenHash: Buffer;

  private readonly canonicalWorkspaceRoot: string;

  constructor(config: HandshakeConfig) {
    this.expectedTokenHash = sha256(config.token);
    this.canonicalWorkspaceRoot = canonicalizeWorkspaceRoot(config.workspaceRoot);
  }

  get workspaceRoot(): string {
    return this.canonicalWorkspaceRoot;
  }

  validate(value: unknown): HandshakeOutcome {
    if (!isRecord(value)) {
      return failure(Protocol.INVALID_PARAMS, 'daemon.connect requires a params object');
    }

    const protocolVersion = value.protocolVersion;
    const token = value.token;
    const workspaceRoot = value.workspaceRoot;

    if (typeof protocolVersion !== 'string') {
      return failure(Protocol.INVALID_PARAMS, 'protocolVersion must be a string');
    }

    if (typeof token !== 'string') {
      return failure(Protocol.INVALID_PARAMS, 'token must be a string');
    }

    if (typeof workspaceRoot !== 'string') {
      return failure(Protocol.INVALID_PARAMS, 'workspaceRoot must be a string');
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

    if (!this.tokensMatch(token)) {
      return failure(Protocol.AUTH_FAILED, 'Invalid daemon authentication token');
    }

    const candidateRoot = canonicalizeWorkspaceRoot(workspaceRoot);

    if (candidateRoot !== this.canonicalWorkspaceRoot) {
      return failure(
        Protocol.WORKSPACE_MISMATCH,
        'Workspace root does not match the daemon workspace',
        {
          expected: this.canonicalWorkspaceRoot,
          actual: candidateRoot,
        },
      );
    }

    const client = parseClientIdentity(value.client);
    const capabilities = isUnknownArray(value.capabilities)
      ? value.capabilities.filter((entry): entry is string => typeof entry === 'string')
      : undefined;

    const params: DaemonConnectParams = {
      protocolVersion,
      token,
      workspaceRoot: candidateRoot,
      ...(client === undefined ? {} : { client }),
      ...(capabilities === undefined ? {} : { capabilities }),
    };

    return { ok: true, params };
  }

  private tokensMatch(candidate: string): boolean {
    return timingSafeEqual(this.expectedTokenHash, sha256(candidate));
  }
}
