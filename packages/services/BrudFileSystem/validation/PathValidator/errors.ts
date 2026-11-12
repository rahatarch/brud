/**
 * External path-rule vocabulary.
 *
 * Preserved verbatim so the pre-Phase-3 contract (public `rule` strings on
 * thrown errors, `ExternalPathRule` type) keeps working. The kernel
 * vocabulary is `PathRule` in `ValidationService/contracts/rules.ts`;
 * `toExternalPathRule` is the one-way projection between them.
 */
export type ExternalPathRule =
  | 'NULL_BYTE'
  | 'TRAVERSAL'
  | 'RESERVED_DEVICE'
  | 'ALTERNATE_DATA_STREAM'
  | 'SYMLINK_ESCAPE'
  | 'OUTSIDE_ROOT';

import { PathViolationError } from '../../../ValidationService/contracts/errors.js';
import type { PathRule } from '../../../ValidationService/contracts/rules.js';

/** Projects a kernel path rule onto the external six-member vocabulary. */
export function toExternalPathRule(rule: PathRule): ExternalPathRule {
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
  readonly rule: ExternalPathRule;
  readonly root: string;
  readonly candidatePath: string;
  readonly reason: string;
}

/**
 * Path-rule violation adapter.
 *
 * A `PathViolationError` that also carries the external six-member rule name,
 * so callers can narrow on either vocabulary from one object.
 */
export class PathRuleViolationError extends PathViolationError {
  /** External rule name, also mirrored onto `rule`. */
  public readonly externalRule: ExternalPathRule;

  /** Caller-supplied path as seen by the external surface. */
  public readonly candidatePath: string;

  /** Reason text as seen by the external surface. */
  public readonly reason: string;

  /** Constructs the adapter from external rule details. */
  constructor(details: PathViolationDetails) {
    super(externalToKernelRule(details.rule), details.candidatePath, details.reason, details.root);
    this.name = 'PathRuleViolationError';
    this.externalRule = details.rule;
    this.candidatePath = details.candidatePath;
    this.reason = details.reason;
    this.rule = details.rule;
  }
}

/** Projects the external vocabulary onto the kernel path rules. */
export function externalToKernelRule(rule: ExternalPathRule): PathRule {
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
