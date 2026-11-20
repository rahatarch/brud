import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provisionIdentityRegistryStorage } from '../../../services/IdentityRegistry/storage/registryDocument.js';

/**
 * One private state directory per test process. A fixed, shared directory name
 * under the system temp directory breaks when another user (or an earlier
 * run under another account) owns it, and lets two processes collide.
 */
let processStateRoot: string | undefined;

function stateRoot(): string {
  processStateRoot ??= realpathSync(mkdtempSync(join(tmpdir(), 'brud-kernel-test-state-')));

  return processStateRoot;
}

/** Registry paths already provisioned in this process, keyed by workspace root. */
const REGISTRY_PATHS = new Map<string, string>();

/** Scope-record paths per workspace root, provisioned by the registry. */
const SCOPE_RECORD_PATHS = new Map<string, string>();

/**
 * Returns a real, provisioned identity registry file for one test workspace.
 *
 * The file lives outside the workspace in a per-process operator-state
 * directory. Tests that need a missing or corrupt registry supply their own
 * path instead of using this helper.
 */
export function identityRegistryContextOptions(
  workspaceRoot: string,
): Record<string, unknown> {
  let registryPath = REGISTRY_PATHS.get(workspaceRoot);

  if (registryPath === undefined) {
    const digest = createHash('sha256')
      .update(workspaceRoot)
      .digest('hex')
      .slice(0, 16);
    const directory = join(stateRoot(), 'identity-registries', digest);

    mkdirSync(directory, { recursive: true });
    registryPath = join(directory, 'registry.json');

    if (!existsSync(registryPath)) {
      provisionIdentityRegistryStorage(registryPath);
    }

    REGISTRY_PATHS.set(workspaceRoot, registryPath);
  }

  return { 'identity.registry.path': registryPath };
}

/**
 * Provisions a fresh registry outside any workspace.
 *
 * Concurrent kernels in one process must not share a registry file: the
 * protected-path guard is ref-counted and a second kernel's write would be
 * refused by the first kernel's claim.
 */
export function createIsolatedIdentityRegistryContext(): Record<string, unknown> {
  const directory = mkdtempSync(join(tmpdir(), 'brud-test-identity-isolated-'));
  const registryPath = join(directory, 'registry.json');

  provisionIdentityRegistryStorage(registryPath);

  return { 'identity.registry.path': registryPath };
}

/**
 * Returns the protected scope-record path for one test workspace.
 *
 * The registry creates the file on its first successful boot, so this helper
 * only reserves a per-workspace location outside the workspace.
 */
export function exposedApiScopeRecordContextOptions(
  workspaceRoot: string,
): Record<string, unknown> {
  let recordPath = SCOPE_RECORD_PATHS.get(workspaceRoot);

  if (recordPath === undefined) {
    const digest = createHash('sha256')
      .update(workspaceRoot)
      .digest('hex')
      .slice(0, 16);
    const directory = join(stateRoot(), 'exposed-api-scopes', digest);

    mkdirSync(directory, { recursive: true });
    recordPath = join(directory, 'scope-record.json');
    SCOPE_RECORD_PATHS.set(workspaceRoot, recordPath);
  }

  return { 'exposedApi.scopeRecord.path': recordPath };
}

/**
 * Builds the context bag for kernel tests: only the fields the kernel's own
 * hardcore services declare (the identity registry file and the scope record).
 * The kernel knows no domain, so no workspace, settings, filesystem, terminal
 * or history field belongs here (`test.root` is opaque); a test that needs a participant's field
 * supplies it from that participant's own fixture.
 */
export function workspaceContextOptions(
  workspaceRoot: string,
): Record<string, unknown> {
  return {
    // An opaque option the kernel passes through untouched; tests use it to
    // prove the bag reaches a participant, with no meaning to the kernel.
    'test.root': workspaceRoot,
    ...identityRegistryContextOptions(workspaceRoot),
    ...exposedApiScopeRecordContextOptions(workspaceRoot),
  };
}
