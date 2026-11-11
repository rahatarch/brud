/**
 * Raised when a service that needs a workspace root is composed without one.
 *
 * The workspace root is a service-owned option, never a kernel-core concern.
 * The host places it in the generic options bag under `options.workspaceRoot`
 * before boot; the same bag reaches runtime service contexts unchanged.
 */
export class MissingWorkspaceRootError extends Error {
  public readonly code = 'WORKSPACE_ROOT_MISSING' as const;

  constructor(consumer: string = 'brud.core.workspace') {
    super(
      `${consumer} requires a workspace root in the kernel options bag (options.workspaceRoot)`,
    );
    this.name = 'MissingWorkspaceRootError';
  }
}

/**
 * Reads the workspace root from an opaque options bag.
 *
 * Services call this at construction and at runtime. The core never does: it
 * only carries the bag. A missing or malformed value raises
 * {@link MissingWorkspaceRootError} naming the consumer.
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
    throw new MissingWorkspaceRootError(consumer);
  }

  return workspaceRoot;
}