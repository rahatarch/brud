import type { ValidationPolicy } from '../contracts/IValidationService.js';

/**
 * Canonical kernel-owned path denylist (audit A10).
 *
 * This is the single source of truth for the protected-path policy. The list
 * is hardcoded in memory and is never materialized on disk. Entries match the
 * exact workspace-relative path or any descendant (`entry` or `entry/**`).
 *
 * `.brudignore` is included because the user owns that policy file: AI tools
 * must never mutate, delete, or read the rules that constrain them.
 */
export const A10_PROTECTED_PATHS = [
  '.brud/history',
  '.git',
  '.brud/settings.json',
  '.brudignore',
] as const;

/**
 * Default frozen policy used by standalone compositions.
 *
 * The standard kernel ingests the boot settings snapshot through
 * `pinBootPolicy`; this value only keeps a directly constructed
 * `ValidationService` (and the filesystem's standalone fallback) fail-closed.
 */
export const DEFAULT_VALIDATION_POLICY: ValidationPolicy = Object.freeze({
  workspaceBoundaryEnabled: true,
  commandValidationEnabled: true,
  toolAllowList: Object.freeze({}),
  readConcurrency: 16,
  readMaxBatchFiles: 100,
  readMaxAggregateBytes: 8 * 1024 * 1024,
  schemaVersion: 1 as const,
});

/**
 * Normalizes a workspace-relative path for policy comparison.
 *
 * Backslashes become `/`, repeated and leading `./` segments are removed, and
 * a trailing separator is dropped. The result never starts with `/`.
 *
 * @param value - Workspace-relative path.
 */
export function normalizePolicyPath(value: string): string {
  return value
    .replace(/\\/gu, '/')
    .replace(/^(?:\.\/)+/u, '')
    .replace(/\/+/gu, '/')
    .replace(/\/$/u, '');
}

/**
 * Reports whether a workspace-relative path is on the canonical A10 denylist.
 *
 * A path matches when it equals a protected entry or is contained beneath it.
 * Comparison is case-insensitive on every flavor: Windows treats these names
 * case-insensitively, and denying `.GIT` on POSIX is a safe superset that
 * cannot weaken the guard.
 *
 * @param relativePath - Workspace-relative path.
 */
export function isA10ProtectedPath(relativePath: string): boolean {
  const candidate = normalizePolicyPath(relativePath).toLowerCase();

  return A10_PROTECTED_PATHS.some(
    (entry) => candidate === entry || candidate.startsWith(`${entry}/`),
  );
}