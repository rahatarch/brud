/**
 * Context options for tests of the official services.
 *
 * The kernel's own test helper is domain-neutral. The services own the domain
 * fields (workspace, settings, filesystem, terminal, history), so the bag that
 * carries them lives here, on top of the kernel helper's identity-registry and
 * scope-record provisioning.
 */
import {
  createIsolatedIdentityRegistryContext,
  exposedApiScopeRecordContextOptions,
  identityRegistryContextOptions,
  workspaceContextOptions as kernelContextOptions,
} from '../../kernel/src/__tests__/support/workspaceContext.js';

export { createIsolatedIdentityRegistryContext, exposedApiScopeRecordContextOptions, identityRegistryContextOptions };

/** The strict namespaced context bag for service tests, rooted at `workspaceRoot`. */
export function workspaceContextOptions(workspaceRoot: string): Record<string, unknown> {
  return {
    ...kernelContextOptions(workspaceRoot),
    'workspace.root': workspaceRoot,
    'settings.root': workspaceRoot,
    'filesystem.root': workspaceRoot,
    'terminal.root': workspaceRoot,
    'history.root': workspaceRoot,
  };
}
