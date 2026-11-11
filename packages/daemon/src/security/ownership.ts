import { lstat, chmod } from 'node:fs/promises';
import type { Stats } from 'node:fs';

/**
 * Result of verifying a local endpoint against the current process identity.
 *
 * `unsupported` means the platform does not expose the metadata needed to
 * verify the endpoint from Node. It is reported, never treated as success.
 */
export type EndpointOwnership =
  | {
      readonly status: 'verified';
      readonly uid: number;
      readonly mode: number;
    }
  | {
      readonly status: 'unsupported';
      readonly platform: NodeJS.Platform;
      readonly reason: string;
    };

export class EndpointOwnershipError extends Error {
  readonly endpointPath: string;

  constructor(endpointPath: string, message: string) {
    super(message);
    this.name = 'EndpointOwnershipError';
    this.endpointPath = endpointPath;
  }
}

function currentUid(): number | undefined {
  return typeof process.getuid === 'function' ? process.getuid() : undefined;
}

function describeMode(mode: number): string {
  return (mode & 0o777).toString(8).padStart(3, '0');
}

async function inspect(path: string): Promise<Stats> {
  try {
    return await lstat(path);
  } catch (error: unknown) {
    throw new EndpointOwnershipError(
      path,
      `Cannot inspect daemon endpoint "${path}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Verifies that the endpoint file is owned by this process's user and is not
 * reachable by other users.
 *
 * On POSIX this is the operating-system ownership half of D-01: a socket that
 * only the owning user can open is the strongest peer-identity control Node
 * can enforce without a native `SO_PEERCRED` binding. Windows named pipes do
 * not expose their security descriptor through `node:fs`, so the function
 * reports `unsupported` instead of pretending to verify.
 */
export async function verifyEndpointOwnership(
  endpointPath: string,
): Promise<EndpointOwnership> {
  if (process.platform === 'win32') {
    return {
      status: 'unsupported',
      platform: process.platform,
      reason: 'Windows named pipes do not expose ownership or mode through node:fs',
    };
  }

  const info = await inspect(endpointPath);
  const uid = currentUid();

  if (uid === undefined) {
    return {
      status: 'unsupported',
      platform: process.platform,
      reason: 'The platform does not expose process.getuid()',
    };
  }

  if (info.uid !== uid) {
    throw new EndpointOwnershipError(
      endpointPath,
      `Daemon endpoint "${endpointPath}" is owned by uid ${info.uid}, expected ${uid}`,
    );
  }

  if ((info.mode & 0o077) !== 0) {
    throw new EndpointOwnershipError(
      endpointPath,
      `Daemon endpoint "${endpointPath}" has insecure mode ${describeMode(info.mode)}`,
    );
  }

  return { status: 'verified', uid, mode: info.mode & 0o777 };
}

/**
 * Forces the endpoint to owner-only access and verifies the result.
 *
 * Called by the daemon after bind, before any connection is accepted.
 */
export async function enforceEndpointOwnership(endpointPath: string): Promise<EndpointOwnership> {
  if (process.platform === 'win32') {
    return {
      status: 'unsupported',
      platform: process.platform,
      reason: 'Windows named pipes do not expose ownership or mode through node:fs',
    };
  }

  try {
    await chmod(endpointPath, 0o600);
  } catch (error: unknown) {
    throw new EndpointOwnershipError(
      endpointPath,
      `Cannot set owner-only mode on daemon endpoint "${endpointPath}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return await verifyEndpointOwnership(endpointPath);
}