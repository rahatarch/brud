/** Namespace owned by the Workspace Service in the context contract. */
export const WORKSPACE_CONTEXT_SCOPE = 'workspace';

/** Namespaced context field holding the workspace root. */
export const WORKSPACE_ROOT_CONTEXT_FIELD = 'workspace.root';

/**
 * Raised when a service that needs a workspace root is composed without one.
 *
 * The workspace root is a service-owned option, never a kernel-core concern.
 * The preferred location is the namespaced field `options['workspace.root']`.
 * Legacy consumers may still read the flat `options.workspaceRoot` key.
 */
export class MissingWorkspaceRootError extends Error {
  public readonly code = 'WORKSPACE_ROOT_MISSING' as const;

  constructor(
    consumer: string = 'brud.core.workspace',
    field: string = WORKSPACE_ROOT_CONTEXT_FIELD,
  ) {
    super(
      `${consumer} requires a workspace root in the kernel options bag (options['${field}']; legacy alias: options.workspaceRoot)`,
    );
    this.name = 'MissingWorkspaceRootError';
  }
}

/**
 * Reads the namespaced workspace root from an opaque options bag.
 *
 * This is the migrated path used by the Workspace Service. Legacy services
 * keep {@link requireWorkspaceRoot} until they migrate.
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

/**
 * Reads the legacy flat workspace root from an opaque options bag.
 *
 * Kept for services that have not migrated to the dynamic context contract.
 *
 * @param options - Opaque options bag carried by the context.
 * @param consumer - Service id used in the error message.
 * @returns The declared workspace root.
 */
export function requireWorkspaceRoot(
  options: Readonly<Record<string, unknown>>,
  consumer: string,
): string {
  const workspaceRoot = options['workspaceRoot'];

  if (typeof workspaceRoot !== 'string' || workspaceRoot.length === 0) {
    throw new MissingWorkspaceRootError(consumer, 'workspaceRoot');
  }

  return workspaceRoot;
}