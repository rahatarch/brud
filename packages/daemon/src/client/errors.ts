import type { JsonRpcId, RpcErrorCode, RpcErrorDetails } from '@brud/protocol';

export class DaemonClientError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DaemonClientError';
  }
}

export interface DaemonRpcErrorOptions {
  readonly code: RpcErrorCode;
  readonly message: string;
  readonly method: string;
  readonly requestId: JsonRpcId;
  readonly details?: RpcErrorDetails;
}

export class DaemonRpcError extends DaemonClientError {
  readonly code: RpcErrorCode;

  readonly method: string;

  readonly requestId: JsonRpcId;

  readonly details: RpcErrorDetails | undefined;

  constructor(options: DaemonRpcErrorOptions) {
    super(options.message);
    this.name = 'DaemonRpcError';
    this.code = options.code;
    this.method = options.method;
    this.requestId = options.requestId;
    this.details = options.details;
  }
}

export class DaemonDisconnectedError extends DaemonClientError {
  constructor(message = 'Daemon connection is closed', options?: ErrorOptions) {
    super(message, options);
    this.name = 'DaemonDisconnectedError';
  }
}

export interface DaemonRequestTimeoutErrorOptions {
  readonly requestId: JsonRpcId;
  readonly method: string;
  readonly timeoutMs: number;
}

export class DaemonRequestTimeoutError extends DaemonClientError {
  readonly requestId: JsonRpcId;

  readonly method: string;

  readonly timeoutMs: number;

  constructor(options: DaemonRequestTimeoutErrorOptions) {
    super(`Request "${options.method}" timed out after ${options.timeoutMs} ms`);
    this.name = 'DaemonRequestTimeoutError';
    this.requestId = options.requestId;
    this.method = options.method;
    this.timeoutMs = options.timeoutMs;
  }
}

export interface DaemonRequestCancelledErrorOptions {
  readonly requestId: JsonRpcId;
  readonly method: string;
}

export class DaemonRequestCancelledError extends DaemonClientError {
  readonly requestId: JsonRpcId;

  readonly method: string;

  constructor(options: DaemonRequestCancelledErrorOptions) {
    super(`Request "${options.method}" was cancelled`);
    this.name = 'DaemonRequestCancelledError';
    this.requestId = options.requestId;
    this.method = options.method;
  }
}

export class DaemonConnectionError extends DaemonClientError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DaemonConnectionError';
  }
}

export class DaemonSpawnError extends DaemonClientError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DaemonSpawnError';
  }
}

export interface DaemonNotRunningErrorOptions {
  readonly workspaceRoot: string;
  readonly socketPath: string;
  readonly cause?: unknown;
}

export class DaemonNotRunningError extends DaemonClientError {
  readonly workspaceRoot: string;

  readonly socketPath: string;

  constructor(options: DaemonNotRunningErrorOptions) {
    super(
      `No daemon is running for workspace "${options.workspaceRoot}" at "${options.socketPath}"`,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'DaemonNotRunningError';
    this.workspaceRoot = options.workspaceRoot;
    this.socketPath = options.socketPath;
  }
}

export interface DaemonStartupTimeoutErrorOptions {
  readonly workspaceRoot: string;
  readonly timeoutMs: number;
  readonly cause?: unknown;
}

export class DaemonStartupTimeoutError extends DaemonClientError {
  readonly workspaceRoot: string;

  readonly timeoutMs: number;

  constructor(options: DaemonStartupTimeoutErrorOptions) {
    super(
      `Daemon for workspace "${options.workspaceRoot}" did not become ready within ${options.timeoutMs} ms`,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'DaemonStartupTimeoutError';
    this.workspaceRoot = options.workspaceRoot;
    this.timeoutMs = options.timeoutMs;
  }
}
