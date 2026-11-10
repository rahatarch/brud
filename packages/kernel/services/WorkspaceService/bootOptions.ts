/**
 * Raised when the workspace service is composed without a workspace root.
 *
 * The workspace root is a service-owned option, never a kernel-core concern.
 * The composition must place it in the generic options bag under
 * `options.workspaceRoot` before boot.
 */
export class MissingWorkspaceRootError extends Error {
  public readonly code = 'WORKSPACE_ROOT_MISSING' as const;

  constructor() {
    super(
      'brud.core.workspace requires a workspace root in the kernel options bag (options.workspaceRoot)',
    );
    this.name = 'MissingWorkspaceRootError';
  }
}