/** Namespace owned by the Workspace Service in the context contract. */
export const WORKSPACE_CONTEXT_SCOPE = 'workspace';

/** Namespaced context field holding the workspace root. */
export const WORKSPACE_ROOT_CONTEXT_FIELD = 'workspace.root';

/**
 * Raised when a service that needs a workspace root is composed without one.
 *
 * The workspace root is a service-owned option, never a kernel-core concern.
 * It lives at the namespaced field `options['workspace.root']`.
 */
export class MissingWorkspaceRootError extends Error {
  public readonly code = 'WORKSPACE_ROOT_MISSING' as const;

  constructor(
    consumer: string = 'brud.core.workspace',
    field: string = WORKSPACE_ROOT_CONTEXT_FIELD,
  ) {
    super(
      `${consumer} requires a workspace root in the kernel options bag (options['${field}'])`,
    );
    this.name = 'MissingWorkspaceRootError';
  }
}

/**
 * Reads the namespaced workspace root from an opaque options bag.
 *
 * This is the strict path used by the Workspace Service.
 *
 * @param options - Opaque options bag carried by the context.
 * @param consumer - Service id used in the error message.
 * @returns The declared workspace root.
 */
export function requireNamespacedWorkspaceRoot(
  options: Readonly<Record<string, unknown>>,
  consumer: string,
): string {
  const workspaceRoot = options[WORKSPACE_ROOT_CONTEXT_FIELD];

  if (typeof workspaceRoot !== 'string' || workspaceRoot.length === 0) {
    throw new MissingWorkspaceRootError(consumer);
  }

  return workspaceRoot;
}
