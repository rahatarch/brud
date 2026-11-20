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

export interface HandshakeFailure {
  readonly ok: false;
  readonly code: RpcErrorCode;
  readonly message: string;
  readonly data?: RpcErrorDetails;
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