import * as path from 'node:path';
import type { PathRule } from '../contracts/rules.js';
import { PathViolationError } from '../contracts/errors.js';
import type { ValidationFlavor } from '../contracts/IValidationService.js';

/**
 * Lexical path vocabulary, migrated from
 * `BrudFileSystem/validation/PathValidator/PathValidator.ts`.
 *
 * This module is the single owner of the path-integrity regexes. Everything
 * that needs a flavor-aware `path` implementation, a normalized segment list,
 * or the Windows alias predicates imports from here so the rule set exists
 * exactly once.
 */

/** Null byte anywhere in the candidate. */
export const NULL_BYTE_PATTERN = /\0/;

/** UNC share or device prefix (`//x`, `\\x`). */
export const UNC_PATTERN = /^[\\/]{2}/;

/** NT object prefix (`\\??\\`). */
export const NT_OBJECT_PREFIX_PATTERN = /^[\\/]\?\?[\\/]/;

/** Drive-qualified path (`C:` followed by a separator or nothing). */
export const DRIVE_QUALIFIER_PATTERN = /^[A-Za-z]:/;

/** Windows drive-relative path (`C:notes`). */
export const DRIVE_RELATIVE_PATTERN = /^[A-Za-z]:(?![\\/])/;

/** Segment separator for either flavor. */
export const SEGMENT_SEPARATOR_PATTERN = /[\\/]/;

/** Trailing dots and spaces, which Windows silently trims. */
export const WINDOWS_TRAILING_DOTS_OR_SPACES_PATTERN = /[. ]+$/u;

/** DOS device names, with or without an extension. */
export const WINDOWS_RESERVED_DEVICE_PATTERN = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/iu;

/**
 * Classifies a candidate before it is resolved.
 *
 * - `root`: the empty path or `.`.
 * - `absolute`: an absolute path for the configured flavor.
 * - `ambiguous-absolute`: UNC, device, NT object, or drive-relative form whose
 *   root identity cannot be trusted.
 * - `relative`: everything else, still subject to the relative lexical rules.
 */
export type LexicalKind = 'root' | 'absolute' | 'ambiguous-absolute' | 'relative';

/** Lexical classification of a candidate. */
export interface LexicalClassification {
  readonly kind: LexicalKind;
  /** Candidate normalized through the flavor's `resolve`. */
  readonly normalized: string;
}

/** Segment-level lexical findings for a relative candidate. */
export interface SegmentViolation {
  readonly rule: PathRule;
  readonly reason: string;
}

/**
 * Returns the path implementation for a flavor.
 *
 * @param flavor - Path flavor to materialize.
 */
export function pathApiFor(flavor: ValidationFlavor): path.PlatformPath {
  return flavor === 'win32' ? path.win32 : path.posix;
}

/**
 * Resolves the effective flavor, defaulting to the host platform.
 *
 * @param explicit - Flavor supplied by the caller, when any.
 */
export function defaultPathFlavor(explicit?: ValidationFlavor): ValidationFlavor {
  if (explicit !== undefined) {
    return explicit;
  }

  return process.platform === 'win32' ? 'win32' : 'posix';
}

/**
 * Splits a candidate into segments for either separator.
 *
 * @param candidate - Path text.
 */
export function splitSegments(candidate: string): readonly string[] {
  return candidate.split(SEGMENT_SEPARATOR_PATTERN);
}

/**
 * Classifies a candidate without touching the filesystem.
 *
 * @param candidate - Path text.
 * @param flavor - Path flavor.
 */
export function classifyPath(candidate: string, flavor: ValidationFlavor): LexicalClassification {
  const api = pathApiFor(flavor);

  if (candidate === '' || candidate === '.') {
    return { kind: 'root', normalized: candidate };
  }

  if (
    UNC_PATTERN.test(candidate)
    || NT_OBJECT_PREFIX_PATTERN.test(candidate)
    || (flavor === 'win32' && DRIVE_RELATIVE_PATTERN.test(candidate))
  ) {
    return { kind: 'ambiguous-absolute', normalized: api.resolve(candidate) };
  }

  if (api.isAbsolute(candidate)) {
    return { kind: 'absolute', normalized: api.resolve(candidate) };
  }

  return { kind: 'relative', normalized: api.resolve(candidate) };
}

function violation(rule: PathRule, candidatePath: string, reason: string, root: string): PathViolationError {
  return new PathViolationError(rule, candidatePath, reason, root);
}

/**
 * Applies the Windows segment rules (trailing aliases, devices, ADS).
 *
 * @param candidate - Original candidate, echoed in the error.
 * @param segments - Segments of the candidate.
 * @param root - Root label.
 */
export function assertWindowsSegments(
  candidate: string,
  segments: readonly string[],
  root = '',
): void {
  for (const segment of segments) {
    if (segment.length === 0 || segment === '.') {
      continue;
    }

    const normalized = segment.replace(WINDOWS_TRAILING_DOTS_OR_SPACES_PATTERN, '');

    if (segment === '..') {
      throw violation(
        'PATH.PARENT_SEGMENT',
        candidate,
        'parent traversal segments are not permitted',
        root,
      );
    }

    if (normalized === '' || normalized === '.' || normalized === '..') {
      throw violation(
        'PATH.WIN_TRAILING_ALIAS_TRAVERSAL',
        candidate,
        'Windows path segments must not resolve to "." or ".." after trailing dots and spaces are trimmed',
        root,
      );
    }

    if (normalized !== segment) {
      throw violation(
        'PATH.WIN_TRAILING_DOT_OR_SPACE',
        candidate,
        'Windows path segments with trailing dots or spaces are not permitted',
        root,
      );
    }

    if (WINDOWS_RESERVED_DEVICE_PATTERN.test(normalized)) {
      throw violation(
        'PATH.WIN_RESERVED_DEVICE',
        candidate,
        'Windows reserved device names are not permitted',
        root,
      );
    }

    if (normalized.includes(':')) {
      throw violation(
        'PATH.WIN_ALT_DATA_STREAM',
        candidate,
        'Windows alternate data streams are not permitted',
        root,
      );
    }
  }
}

/**
 * Reports the first Windows segment violation for a relative candidate.
 *
 * Non-throwing counterpart of {@link assertWindowsSegments}, used by the
 * orchestrator to turn a segment problem into a decision.
 *
 * @param segments - Segments of the candidate.
 */
export function classifyWindowsSegments(segments: readonly string[]): SegmentViolation | null {
  for (const segment of segments) {
    if (segment.length === 0 || segment === '.') {
      continue;
    }

    const normalized = segment.replace(WINDOWS_TRAILING_DOTS_OR_SPACES_PATTERN, '');

    if (segment === '..') {
      return { rule: 'PATH.PARENT_SEGMENT', reason: 'parent traversal segments are not permitted' };
    }

    if (normalized === '' || normalized === '.' || normalized === '..') {
      return {
        rule: 'PATH.WIN_TRAILING_ALIAS_TRAVERSAL',
        reason: 'Windows path segments must not resolve to "." or ".." after trailing dots and spaces are trimmed',
      };
    }

    if (normalized !== segment) {
      return {
        rule: 'PATH.WIN_TRAILING_DOT_OR_SPACE',
        reason: 'Windows path segments with trailing dots or spaces are not permitted',
      };
    }

    if (WINDOWS_RESERVED_DEVICE_PATTERN.test(normalized)) {
      return {
        rule: 'PATH.WIN_RESERVED_DEVICE',
        reason: 'Windows reserved device names are not permitted',
      };
    }

    if (normalized.includes(':')) {
      return {
        rule: 'PATH.WIN_ALT_DATA_STREAM',
        reason: 'Windows alternate data streams are not permitted',
      };
    }
  }

  return null;
}

/**
 * Classifies the lexical rules a relative candidate violates.
 *
 * The checks run in a fixed order (null byte, UNC/device, drive, absolute,
 * segment rules) so the emitted rule is deterministic across flavors. On
 * POSIX the Windows segment rules are skipped, exactly as before.
 *
 * @param candidate - Relative path text.
 * @param flavor - Path flavor.
 * @returns The first violated rule, or `null`.
 */
export function classifyRelativePath(
  candidate: string,
  flavor: ValidationFlavor,
): SegmentViolation | null {
  if (NULL_BYTE_PATTERN.test(candidate)) {
    return { rule: 'PATH.NULL_BYTE', reason: 'path contains a null byte' };
  }

  if (candidate === '' || candidate === '.') {
    return null;
  }

  if (UNC_PATTERN.test(candidate)) {
    return { rule: 'PATH.UNC_OR_DEVICE', reason: 'UNC paths are not permitted' };
  }

  if (DRIVE_QUALIFIER_PATTERN.test(candidate)) {
    return { rule: 'PATH.DRIVE_QUALIFIED', reason: 'drive-qualified paths are not permitted' };
  }

  if (pathApiFor(flavor).isAbsolute(candidate)) {
    return { rule: 'PATH.ABSOLUTE', reason: 'absolute paths are not permitted' };
  }

  const segments = splitSegments(candidate);

  if (flavor === 'win32') {
    return classifyWindowsSegments(segments);
  }

  if (segments.some((segment) => segment === '..')) {
    return { rule: 'PATH.PARENT_SEGMENT', reason: 'parent traversal segments are not permitted' };
  }

  return null;
}

/**
 * Applies the lexical rules to a relative candidate and throws on a violation.
 *
 * Modules that need an exception at a storage gate call this; the
 * orchestrator uses {@link classifyRelativePath} instead.
 *
 * @param candidate - Relative path text.
 * @param flavor - Path flavor.
 * @param root - Root label attached to the violation.
 * @returns The candidate unchanged.
 * @throws {PathViolationError} When a lexical rule is violated.
 */
export function assertSafeRelativePath(
  candidate: string,
  flavor: ValidationFlavor = defaultPathFlavor(),
  root = '',
): string {
  const violationResult = classifyRelativePath(candidate, flavor);

  if (violationResult !== null) {
    throw violation(violationResult.rule, candidate, violationResult.reason, root);
  }

  return candidate;
}

/**
 * Reports whether an absolute candidate is contained by a root.
 *
 * Segment-aware: `/ws-evil` is never contained by `/ws`. The workspace
 * registry (`WorkspaceService/model/pathRules.ts`) re-exports this function so
 * the comparison exists exactly once.
 *
 * @param root - Canonical root.
 * @param candidate - Absolute candidate.
 * @param flavor - Path flavor.
 */
export function isContainedInRoot(
  root: string,
  candidate: string,
  flavor: ValidationFlavor,
): boolean {
  const api = pathApiFor(flavor);
  const relativePath = api.relative(root, candidate);

  return relativePath === ''
    || (
      relativePath !== '..'
      && !relativePath.startsWith(`..${api.sep}`)
      && !api.isAbsolute(relativePath)
    );
}
