/**
 * Legacy path-rule vocabulary.
 *
 * Preserved verbatim so the pre-Phase-3 contract (public `rule` strings on
 * thrown errors, `PathViolationRule` type) keeps working. The kernel
 * vocabulary is `PathRule` in `ValidationService/contracts/rules.ts`;
 * `toLegacyRule` is the one-way projection between them.
 */
export type PathViolationRule =
  | 'NULL_BYTE'
  | 'TRAVERSAL'
  | 'RESERVED_DEVICE'
  | 'ALTERNATE_DATA_STREAM'
  | 'SYMLINK_ESCAPE'
  | 'OUTSIDE_ROOT';

import { PathViolationError } from '../../../ValidationService/contracts/errors.js';
import type { PathRule } from '../../../ValidationService/contracts/rules.js';

/** Projects a kernel path rule onto the legacy six-member vocabulary. */
export function toLegacyRule(rule: PathRule): PathViolationRule {
  switch (rule) {
    case 'PATH.NULL_BYTE':
      return 'NULL_BYTE';
    case 'PATH.WIN_RESERVED_DEVICE':
      return 'RESERVED_DEVICE';
    case 'PATH.WIN_ALT_DATA_STREAM':
      return 'ALTERNATE_DATA_STREAM';
    case 'PATH.SYMLINK_ESCAPE':
      return 'SYMLINK_ESCAPE';
    case 'PATH.OUTSIDE_ROOT':
      return 'OUTSIDE_ROOT';
    default:
      return 'TRAVERSAL';
  }
}

export interface PathViolationDetails {
  readonly rule: PathViolationRule;
  readonly root: string;
  readonly candidatePath: string;
  readonly reason: string;
}

/**
 * Thrown by the legacy `PathValidator`/`assertSafeRelativePath` surface.
 *
 * Phase 3 keeps this error alive as an adapter: it is a `PathViolationError`
 * carrying the kernel `PathRule` on `kernelRule` and the legacy six-member
 * name on `rule`, so both vocabularies stay observable from one object.
 * `ScopedPartitionFacade` and `WorkspaceService` read whichever they know.
 */
export class PathTraversalViolationError extends PathViolationError {
  /** Legacy rule name, also mirrored onto `rule`. */
  public readonly legacyRule: PathViolationRule;

  /** Legacy alias of the caller-supplied path. */
  public readonly candidatePath: string;

  /** Legacy alias of the reason. */
  public readonly reason: string;

  /** Legacy constructor shape preserved for third-party callers. */
  constructor(details: PathViolationDetails) {
    super(legacyToKernelRule(details.rule), details.candidatePath, details.reason, details.root);
    this.name = 'PathTraversalViolationError';
    this.legacyRule = details.rule;
    this.candidatePath = details.candidatePath;
    this.reason = details.reason;
    this.rule = details.rule;
  }
}

/** Projects the legacy vocabulary onto the kernel path rules. */
export function legacyToKernelRule(rule: PathViolationRule): PathRule {
  switch (rule) {
    case 'NULL_BYTE':
      return 'PATH.NULL_BYTE';
    case 'RESERVED_DEVICE':
      return 'PATH.WIN_RESERVED_DEVICE';
    case 'ALTERNATE_DATA_STREAM':
      return 'PATH.WIN_ALT_DATA_STREAM';
    case 'SYMLINK_ESCAPE':
      return 'PATH.SYMLINK_ESCAPE';
    case 'OUTSIDE_ROOT':
      return 'PATH.OUTSIDE_ROOT';
    case 'TRAVERSAL':
    default:
      return 'PATH.PARENT_SEGMENT';
  }
}
