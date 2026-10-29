import { win32 } from 'node:path';
import type { PlatformPath } from 'node:path';
import { PathViolationError } from '../../ValidationService/contracts/errors.js';
import {
  DRIVE_QUALIFIER_PATTERN,
  DRIVE_RELATIVE_PATTERN,
  NT_OBJECT_PREFIX_PATTERN,
  NULL_BYTE_PATTERN,
  UNC_PATTERN,
  assertSafeRelativePath,
  defaultPathFlavor,
  isContainedInRoot,
  pathApiFor,
} from '../../ValidationService/engine/pathLexicon.js';
import type { WorkspacePathFlavor } from '../contracts/IWorkspaceService.js';
import {
  WorkspaceConfigurationError,
  WorkspaceViolationError,
} from '../contracts/errors.js';

/**
 * Root-registry helpers.
 *
 * Every path predicate below is imported from
 * `ValidationService/engine/pathLexicon.ts`; this module owns only root
 * identity, routing and kernel-separator translation. It previously redeclared
 * four of those regexes, which is the duplication Phase 3 removes.
 */

/**
 * Matches a Windows-only ambiguous absolute form.
 *
 * UNC shares, DOS device paths and NT object paths are ambiguous on every
 * flavor; a drive-relative path is only ambiguous when evaluated as Windows.
 *
 * @param input - Candidate absolute path.
 * @param flavor - Path flavor the input is interpreted with.
 */
export function isAmbiguousWindowsAbsolute(input: string, flavor: WorkspacePathFlavor): boolean {
  return flavor === 'win32' && DRIVE_RELATIVE_PATTERN.test(input);
}

/**
 * Returns the path implementation for a flavor.
 *
 * `win32` treats both `'\'` and `'/'` as separators and compares
 * case-insensitively; `posix` compares case-sensitively and treats `'\'` as a
 * literal filename character. Selecting this once per call keeps Windows
 * semantics testable on POSIX hosts.
 *
 * @param flavor - Path flavor to materialize.
 */
export function pathApiForFlavor(flavor: WorkspacePathFlavor): PlatformPath {
  return pathApiFor(flavor);
}

/**
 * Resolves the effective flavor, defaulting to the host platform.
 *
 * @param explicit - Flavor supplied by the caller, when any.
 */
export function resolveWorkspaceFlavor(explicit?: WorkspacePathFlavor): WorkspacePathFlavor {
  return explicit ?? defaultPathFlavor();
}

/**
 * Reports whether an input is an absolute path for the flavor.
 *
 * @param input - Candidate path.
 * @param flavor - Path flavor the input is interpreted with.
 */
export function isAbsolutePath(input: string, flavor: WorkspacePathFlavor): boolean {
  return pathApiFor(flavor).isAbsolute(input);
}

/**
 * Normalizes a declared root into the canonical lexical form.
 *
 * Trailing separators are removed and, on Windows, the drive letter is
 * upper-cased so `c:\ws` and `C:\ws` share one identity.
 *
 * @param root - Declared root path.
 * @param flavor - Path flavor to normalize with.
 * @throws {WorkspaceConfigurationError} When the root is empty, relative, or null-byte-bearing.
 */
export function normalizeRootPath(root: string, flavor: WorkspacePathFlavor): string {
  if (typeof root !== 'string' || root.length === 0) {
    throw new WorkspaceConfigurationError('workspace root must be a non-empty string', 'INVALID_INPUT');
  }

  if (NULL_BYTE_PATTERN.test(root)) {
    throw new WorkspaceConfigurationError('workspace root must not contain a null byte', 'NULL_BYTE');
  }

  const api = pathApiFor(flavor);

  if (!api.isAbsolute(root)) {
    throw new WorkspaceConfigurationError('workspace root must be absolute', 'TRAVERSAL');
  }

  const resolved = api.resolve(root);

  if (flavor === 'win32' && DRIVE_QUALIFIER_PATTERN.test(resolved)) {
    return `${resolved.slice(0, 1).toUpperCase()}${resolved.slice(1)}`;
  }

  return resolved;
}

/**
 * Reports whether a normalized root addresses a filesystem or volume root.
 *
 * @param root - Normalized root path.
 * @param flavor - Path flavor to parse with.
 */
export function isFilesystemRootPath(root: string, flavor: WorkspacePathFlavor): boolean {
  const api = pathApiFor(flavor);

  return api.parse(root).root === root;
}

/**
 * Reports whether a root is a UNC share, device path, or NT object path.
 *
 * These roots alias host resources outside any workspace identity and are
 * rejected unless a host explicitly allows them.
 *
 * @param root - Declared root path.
 */
export function isDeviceOrNetworkRoot(root: string): boolean {
  return UNC_PATTERN.test(root) || NT_OBJECT_PREFIX_PATTERN.test(root);
}

/**
 * Reports whether an absolute path must be rejected before canonicalization.
 *
 * UNC shares, DOS device paths, and NT object paths are never workspace
 * targets, and a Windows drive-relative path (`C:notes`) is ambiguous.
 *
 * @param input - Candidate absolute path.
 * @param flavor - Path flavor the input is interpreted with.
 */
export function isAmbiguousAbsolutePath(input: string, flavor: WorkspacePathFlavor): boolean {
  if (UNC_PATTERN.test(input) || NT_OBJECT_PREFIX_PATTERN.test(input)) {
    return true;
  }

  return isAmbiguousWindowsAbsolute(input, flavor);
}

/**
 * Applies the shared kernel lexical rules to a relative path.
 *
 * Delegating to `assertSafeRelativePath` keeps workspace and filesystem rules
 * identical for null bytes, UNC, drive qualifiers, `..`, Windows reserved
 * devices, alternate data streams, and trailing dot/space aliases.
 *
 * @param relativePath - Relative path to validate.
 * @param flavor - Path flavor to validate with.
 * @param root - Root label attached to a violation, when known.
 * @returns The validated path unchanged.
 * @throws {WorkspaceViolationError} When a lexical rule is violated.
 */
export function assertSafeWorkspaceRelativePath(
  relativePath: string,
  flavor: WorkspacePathFlavor,
  root?: string,
): string {
  try {
    return assertSafeRelativePath(relativePath, flavor, root ?? '');
  } catch (error: unknown) {
    if (error instanceof PathViolationError) {
      throw new WorkspaceViolationError(
        toWorkspaceRule(error.rule as Parameters<typeof toWorkspaceRule>[0]),
        relativePath,
        error.reason,
        root,
      );
    }

    throw error;
  }
}

/**
 * Translates a kernel path rule into the legacy workspace rule vocabulary.
 *
 * The two vocabularies overlap on the containment rules and differ on the
 * finer-grained lexical ones; telemetry aggregates on the workspace names.
 *
 * @param rule - Kernel path rule.
 */
export function toWorkspaceRule(
  rule: import('../../ValidationService/contracts/rules.js').PathRule,
): import('../contracts/errors.js').WorkspaceViolationRule {
  switch (rule) {
    case 'PATH.NULL_BYTE':
      return 'NULL_BYTE';
    case 'PATH.WIN_RESERVED_DEVICE':
      return 'RESERVED_DEVICE';
    case 'PATH.WIN_ALT_DATA_STREAM':
      return 'ALTERNATE_DATA_STREAM';
    case 'PATH.PROTECTED_DENY':
      return 'PROTECTED_PATH_DENIED';
    case 'PATH.ROOT_NOT_MUTABLE':
      return 'PATH_VIOLATION';
    case 'PATH.SIBLING_PREFIX':
      return 'SIBLING_PREFIX';
    case 'PATH.SYMLINK_ESCAPE':
      return 'SYMLINK_ESCAPE';
    case 'PATH.AMBIGUOUS_ROOT':
      return 'AMBIGUOUS_ROOT';
    case 'PATH.UNVERIFIABLE_LINEAGE':
      return 'UNVERIFIABLE_LINEAGE';
    case 'PATH.UNKNOWN_ROOT':
      return 'UNKNOWN_ROOT';
    case 'PATH.INVALID_ROOT':
      return 'FILESYSTEM_ROOT';
    case 'PATH.NON_STRING':
      return 'INVALID_INPUT';
    case 'PATH.PARENT_SEGMENT':
    case 'PATH.UNC_OR_DEVICE':
    case 'PATH.DRIVE_QUALIFIED':
    case 'PATH.DRIVE_RELATIVE':
    case 'PATH.ABSOLUTE':
    case 'PATH.WIN_TRAILING_DOT_OR_SPACE':
    case 'PATH.WIN_TRAILING_ALIAS_TRAVERSAL':
    case 'PATH.OUTSIDE_ROOT':
    case 'PATH.NO_WORKSPACE':
    case 'PATH.CWD_ESCAPE':
    case 'PATH.CWD_DYNAMIC':
    case 'PATH.CWD_INVALID':
    case 'PATH.LISTING_OUTSIDE':
    default:
      return 'TRAVERSAL';
  }
}

/**
 * Computes the relative path from a root to a candidate without escaping.
 *
 * The result is segment-aware: a sibling that merely shares a textual prefix
 * (`/ws-evil` for `/ws`) yields `'../ws-evil'`, never a false containment.
 *
 * @param root - Canonical root.
 * @param candidate - Absolute candidate path.
 * @param flavor - Path flavor to compare with.
 * @returns `''` for the root, otherwise a relative path with host separators.
 */
export function relativeWithinRoot(
  root: string,
  candidate: string,
  flavor: WorkspacePathFlavor,
): string {
  return pathApiFor(flavor).relative(root, candidate);
}

/**
 * Reports whether a candidate shares a textual prefix with a root without
 * being contained by it.
 *
 * This is the classic `startsWith` sibling bug; it is only used to classify a
 * rejection, never to admit a path.
 *
 * @param root - Canonical root.
 * @param candidate - Absolute candidate path.
 * @param flavor - Path flavor to compare with.
 */
export function sharesTextualRootPrefix(
  root: string,
  candidate: string,
  flavor: WorkspacePathFlavor,
): boolean {
  if (isContainedInRoot(root, candidate, flavor)) {
    return false;
  }

  if (flavor === 'win32') {
    return candidate.toLowerCase().startsWith(root.toLowerCase());
  }

  return candidate.startsWith(root);
}

/**
 * Converts a host-native relative path into the kernel `'/'` form.
 *
 * @param relativePath - Relative path with host separators.
 * @param flavor - Path flavor that produced the path.
 */
export function toKernelSeparators(
  relativePath: string,
  flavor: WorkspacePathFlavor,
): string {
  if (relativePath === '' || relativePath === '.') {
    return '';
  }

  if (flavor === 'posix') {
    return relativePath;
  }

  return relativePath.split(win32.sep).join('/');
}

/**
 * Reports whether an input carries a null byte.
 *
 * @param input - Candidate input.
 */
export function hasNullByte(input: string): boolean {
  return NULL_BYTE_PATTERN.test(input);
}

// Path predicates re-exported from the engine so the workspace contract keeps
// its long-standing surface without owning a second implementation.
export { assertSafeRelativePath, defaultPathFlavor, isContainedInRoot, pathApiFor };
