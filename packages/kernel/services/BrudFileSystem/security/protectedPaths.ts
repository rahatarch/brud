import { WorkspaceViolationError } from '../../WorkspaceService/contracts/errors.js';

/**
 * Kernel-owned write/delete denylist (audit A10).
 *
 * These paths govern the kernel itself (settings), its history ledger and
 * content-addressed blobs, and the repository's git metadata. Userland
 * plugins and non-owning core services must never mutate them.
 */
export const PROTECTED_PATH_PATTERNS = [
  '.brud/settings.json',
  '.brud/history',
  '.git',
] as const;

/** A protected prefix paired with the core caller allowed to mutate it. */
export interface TrustedWriteScope {
  /** Workspace-relative prefix, e.g. `.brud/history`. */
  readonly prefix: string;

  /**
   * Owning subsystem description. Documentation only; the capability is the
   * scope value itself, which is only handed to the owning service through
   * the descriptor projection.
   */
  readonly owner: string;
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath
    .replace(/\\/gu, '/')
    .replace(/^(?:\.\/)+/u, '')
    .replace(/\/+/gu, '/')
    .replace(/\/$/u, '')
    .toLowerCase();
}

function matchesProtected(normalizedPath: string, pattern: string): boolean {
  return normalizedPath === pattern || normalizedPath.startsWith(`${pattern}/`);
}

function isWithinScope(normalizedPath: string, scope: string): boolean {
  return normalizedPath === scope || normalizedPath.startsWith(`${scope}/`);
}

/**
 * Reports whether a workspace-relative path is on the immutable denylist.
 *
 * @param relativePath - Kernel-relative path produced by `WorkspaceService`.
 */
export function isProtectedWritePath(relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath);

  return PROTECTED_PATH_PATTERNS.some((pattern) => matchesProtected(normalized, pattern));
}

/**
 * Reports whether a protected path is covered by an explicitly granted scope.
 *
 * @param relativePath - Kernel-relative path.
 * @param scopes - Trusted scope prefixes granted to the caller or instance.
 */
export function isWithinTrustedWriteScope(
  relativePath: string,
  scopes: readonly string[],
): boolean {
  if (scopes.length === 0) {
    return false;
  }

  const normalized = normalizeRelativePath(relativePath);

  return scopes.some((scope) => isWithinScope(normalized, normalizeRelativePath(scope)));
}

/**
 * Throws when a mutation targets the immutable denylist and no trusted scope
 * covers it.
 *
 * @param relativePath - Kernel-relative target path.
 * @param trustedScopes - Prefixes the caller is explicitly allowed to mutate.
 * @throws {WorkspaceViolationError} With rule `PROTECTED_PATH_DENIED`.
 */
export function assertNotProtectedPath(
  relativePath: string,
  trustedScopes: readonly string[] = [],
): void {
  if (!isProtectedWritePath(relativePath)) {
    return;
  }

  if (isWithinTrustedWriteScope(relativePath, trustedScopes)) {
    return;
  }

  throw new WorkspaceViolationError(
    'PROTECTED_PATH_DENIED',
    relativePath,
    'the path is on the kernel protected-path denylist',
  );
}
