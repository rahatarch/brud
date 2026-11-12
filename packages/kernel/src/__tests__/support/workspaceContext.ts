import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provisionIdentityRegistryStorage } from '../../../services/IdentityRegistry/storage/registryDocument.js';

/** Registry paths already provisioned in this process, keyed by workspace root. */
const REGISTRY_PATHS = new Map<string, string>();

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
    const directory = join(
      tmpdir(),
      'brud-test-identity-registries',
      `${String(process.pid)}-${digest}`,
    );

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
 * Builds the strict namespaced context bag used by kernel tests.
 *
 * Every service owns one root field. Tests that boot more than one service can
 * use the full bag; extra declared fields are harmless.
 */
export function workspaceContextOptions(
  workspaceRoot: string,
): Record<string, unknown> {
  return {
    'workspace.root': workspaceRoot,
    'settings.root': workspaceRoot,
    'filesystem.root': workspaceRoot,
    'terminal.root': workspaceRoot,
    'pluginManager.root': workspaceRoot,
    'history.root': workspaceRoot,
    'router.root': workspaceRoot,
    ...identityRegistryContextOptions(workspaceRoot),
  };
}