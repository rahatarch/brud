/**
 * Pure workspace-relative path helpers.
 *
 * They mirror the kernel's lexical rules closely enough to reject the
 * adversarial shapes before a history session is opened. The kernel remains
 * the authority for symlink resolution and containment.
 */
import { FilesystemError } from './errors/index.js';

/** Protected prefixes owned by the kernel (audit A10). */
const PROTECTED_PATHS = ['.brud/settings.json', '.brud/history', '.git'] as const;

export function normalizeRelativePath(candidate: string): string {
  return candidate
    .replace(/\\/gu, '/')
    .replace(/^(?:\.\/)+/u, '')
    .replace(/\/+/gu, '/')
    .replace(/\/$/u, '')
    .toLowerCase();
}

/** Reports whether a path is on the kernel protected-path denylist. */
export function isProtectedPath(candidate: string): boolean {
  const normalized = normalizeRelativePath(candidate);

  return PROTECTED_PATHS.some(
    (protectedPath) => normalized === protectedPath || normalized.startsWith(`${protectedPath}/`),
  );
}

/** Joins two workspace-relative fragments with a single `/`. */
export function joinPath(base: string, child: string): string {
  const left = base.replace(/\\/gu, '/').replace(/\/+$/u, '');
  const right = child.replace(/\\/gu, '/');

  if (left.length === 0) {
    return right;
  }

  if (right.length === 0) {
    return left;
  }

  return `${left}/${right}`;
}

/** Returns the parent directory of a workspace-relative path. */
export function dirnamePath(candidate: string): string {
  const normalized = candidate.replace(/\\/gu, '/').replace(/\/+$/u, '');
  const index = normalized.lastIndexOf('/');

  return index <= 0 ? '' : normalized.slice(0, index);
}

/** Number of non-empty path segments. */
export function depthOf(candidate: string): number {
  return candidate
    .replace(/\\/gu, '/')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.')
    .length;
}

/**
 * Rejects malformed, absolute, traversing, NUL-bearing, and protected paths.
 *
 * This is the plugin's first line of defence. Kernel calls still validate the
 * same path; the early check keeps the error code stable and prevents a
 * history session from being opened for an input that can never succeed.
 */
export function assertSafeTarget(target: string): void {
  if (typeof target !== 'string' || target.length === 0) {
    throw new FilesystemError('VALIDATION_ERROR', target, 'Path must be a non-empty string.');
  }

  if (target.includes('\0')) {
    throw new FilesystemError(
      'WORKSPACE_PATH_VIOLATION',
      target,
      `Path contains a NUL byte: "${target.replace(/\0/gu, '\\0')}"`,
    );
  }

  const normalized = target.replace(/\\/gu, '/');

  if (normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized)) {
    throw new FilesystemError(
      'WORKSPACE_PATH_VIOLATION',
      target,
      `Absolute paths are not allowed: "${target}"`,
    );
  }

  if (normalized.split('/').some((segment) => segment === '..')) {
    throw new FilesystemError(
      'WORKSPACE_PATH_VIOLATION',
      target,
      `Path traversal is not allowed: "${target}"`,
    );
  }

  if (isProtectedPath(normalized)) {
    throw new FilesystemError(
      'PROTECTED_PATH_DENIED',
      target,
      `The path "${target}" is on the kernel protected-path denylist and cannot be modified.`,
    );
  }
}