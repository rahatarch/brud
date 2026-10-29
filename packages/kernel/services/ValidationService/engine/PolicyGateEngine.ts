import type { PolicyRule } from '../contracts/rules.js';
import type { ValidationPolicy } from '../contracts/IValidationService.js';
import { deepFreeze } from '../../SettingsService/model/deepFreeze.js';
import {
  READ_CONCURRENCY_MAX,
  READ_CONCURRENCY_MIN,
  READ_MAX_AGGREGATE_BYTES_MAX,
  READ_MAX_AGGREGATE_BYTES_MIN,
  READ_MAX_BATCH_FILES_MAX,
  READ_MAX_BATCH_FILES_MIN,
} from '../../SettingsService/model/defaults.js';

/**
 * Canonical batch ceilings.
 *
 * The core read engine derives its own `MAX_BATCH_FILES` and
 * `HARD_MAX_AGGREGATE_BYTES` from these two values, so the kernel settings
 * lattice and the legacy reader cannot drift into a split brain: the settings
 * clamps and the reader ceiling are the same numbers by construction.
 */

/** Maximum number of files a single read batch may name. */
export const KERNEL_MAX_BATCH_FILES = READ_MAX_BATCH_FILES_MAX;

/** Maximum aggregate byte budget a read batch may admit. */
export const KERNEL_HARD_MAX_AGGREGATE_BYTES = READ_MAX_AGGREGATE_BYTES_MAX;

/**
 * Frozen policy gate.
 *
 * Policy is ingested once, at construction, from the boot settings snapshot
 * and deep-frozen. There is no setter, no reload hook and no subscription, so
 * a policy value cannot weaken while an operation is in flight (audit §7.3,
 * W-7). The per-call `skipValidation` / `override` / `workspaceBoundaryEnabled`
 * options of the legacy API are deliberately absent here: any caller that
 * supplies them is rejected with `POLICY.PER_CALL_OVERRIDE`.
 */

/** Bounds a governor is clamped into. */
export interface GovernorBounds {
  readonly min: number;
  readonly max: number;
}

/** Ratified governor ranges, sourced from the settings service constants. */
export const GOVERNOR_BOUNDS: Readonly<Record<'readConcurrency' | 'readMaxBatchFiles' | 'readMaxAggregateBytes', GovernorBounds>> =
  Object.freeze({
    readConcurrency: { min: READ_CONCURRENCY_MIN, max: READ_CONCURRENCY_MAX },
    readMaxBatchFiles: { min: READ_MAX_BATCH_FILES_MIN, max: KERNEL_MAX_BATCH_FILES },
    readMaxAggregateBytes: { min: READ_MAX_AGGREGATE_BYTES_MIN, max: KERNEL_HARD_MAX_AGGREGATE_BYTES },
  });

/** A policy call that tried to weaken validation. */
export interface PolicyOverrideRejection {
  readonly rule: Extract<PolicyRule, 'POLICY.PER_CALL_OVERRIDE'>;
  readonly option: string;
  readonly reason: string;
}

/** Keys that never travel with a validation call. */
const FORBIDDEN_OPTION_KEYS = [
  'skipValidation',
  'override',
  'workspaceBoundaryEnabled',
  'commandValidationEnabled',
  'trustedScopes',
] as const;

/**
 * Minimal shape of a persisted governor value.
 */
function clampGovernor(value: number, bounds: GovernorBounds): number {
  if (!Number.isFinite(value)) {
    return bounds.max;
  }

  return Math.min(bounds.max, Math.max(bounds.min, Math.trunc(value)));
}

/**
 * Normalizes a raw policy into the frozen form.
 *
 * Governor values outside the ratified ranges are clamped, matching the
 * settings lattice (`POLICY.VALUE_CLAMPED`). A missing allowlist is treated as
 * "everything enabled", and only literal `false` disables a kind.
 *
 * @param policy - Candidate policy.
 */
export function freezeValidationPolicy(policy: ValidationPolicy): ValidationPolicy {
  return deepFreeze({
    schemaVersion: 1 as const,
    workspaceBoundaryEnabled: policy.workspaceBoundaryEnabled === true,
    commandValidationEnabled: policy.commandValidationEnabled === true,
    toolAllowList: Object.fromEntries(
      Object.entries(policy.toolAllowList)
        .filter(([, enabled]) => typeof enabled === 'boolean')
        .map(([kind, enabled]) => [kind, enabled]),
    ),
    readConcurrency: clampGovernor(policy.readConcurrency, GOVERNOR_BOUNDS.readConcurrency),
    readMaxBatchFiles: clampGovernor(policy.readMaxBatchFiles, GOVERNOR_BOUNDS.readMaxBatchFiles),
    readMaxAggregateBytes: clampGovernor(policy.readMaxAggregateBytes, GOVERNOR_BOUNDS.readMaxAggregateBytes),
  }) as ValidationPolicy;
}

/**
 * Immutable policy holder used by the orchestrator.
 */
export class PolicyGateEngine {
  private readonly policyValue: ValidationPolicy;

  /**
   * @param policy - Boot policy; it is normalized and deep-frozen here.
   */
  constructor(policy: ValidationPolicy) {
    this.policyValue = freezeValidationPolicy(policy);
  }

  /** The frozen policy. */
  get policy(): ValidationPolicy {
    return this.policyValue;
  }

  /** Reports whether workspace containment is enforced. */
  get workspaceBoundaryEnabled(): boolean {
    return this.policyValue.workspaceBoundaryEnabled;
  }

  /** Reports whether command rules are enforced. */
  get commandValidationEnabled(): boolean {
    return this.policyValue.commandValidationEnabled;
  }

  /**
   * Returns the aggregate byte budget for a read batch.
   */
  get readMaxAggregateBytes(): number {
    return this.policyValue.readMaxAggregateBytes;
  }

  /**
   * Returns the batch file ceiling for a read batch.
   */
  get readMaxBatchFiles(): number {
    return this.policyValue.readMaxBatchFiles;
  }

  /**
   * Reports whether the allowlist disables a kind.
   *
   * @param kind - Operation kind.
   */
  isToolEnabled(kind: string): boolean {
    return this.policyValue.toolAllowList[kind] !== false;
  }

  /**
   * Rejects a call that tries to carry its own policy.
   *
   * @param options - Untrusted per-call options, when any.
   */
  rejectPerCallOverride(options: unknown): PolicyOverrideRejection | null {
    if (typeof options !== 'object' || options === null) {
      return null;
    }

    const candidate = options as Record<string, unknown>;

    for (const key of FORBIDDEN_OPTION_KEYS) {
      if (Object.prototype.hasOwnProperty.call(candidate, key) && candidate[key] !== undefined) {
        return {
          rule: 'POLICY.PER_CALL_OVERRIDE',
          option: key,
          reason: `"${key}" cannot be supplied per call; policy is frozen at boot`,
        };
      }
    }

    return null;
  }

  /**
   * Clamps a requested read concurrency into the ratified range.
   *
   * @param requested - Requested concurrency.
   */
  clampConcurrency(requested: number): number {
    return clampGovernor(requested, GOVERNOR_BOUNDS.readConcurrency);
  }

  /**
   * Reports whether a batch may admit more bytes.
   *
   * @param admittedBytes - Bytes already admitted.
   * @param nextBytes - Bytes the candidate would add.
   */
  admitsAggregateBytes(admittedBytes: number, nextBytes: number): boolean {
    return admittedBytes + nextBytes <= this.policyValue.readMaxAggregateBytes;
  }
}
