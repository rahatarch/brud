import {
  CALLER_CLASSES,
  CALL_ORIGINS,
  type CallOrigin,
  type CallerClass,
  type KernelCallContext,
} from '../../../src/contracts/callChain.js';
import { isCapabilityToken } from '../../../src/contracts/capability.js';
import { canonicalJson, cloneJsonRecord, JsonValueError } from '../../shared/canonicalJson.js';
import { ExposedApiInvalidPolicyError } from './errors.js';
import { exposedApiScopeAllowsOrigin, type ExposedApiScope } from './types.js';

/**
 * Layer 1 policy language.
 *
 * A Layer 1 policy is declarative data the giver states in its manifest. The
 * registry evaluates it mechanically and the kernel enforces the result before
 * any of the giver's code runs. The language is small, versioned, and
 * deterministic, carries no executable code, and fails closed: an unknown
 * version, an unknown field, or a malformed field refuses the declaration.
 *
 * Inputs, all assigned by the kernel: the caller's identity class, the chain's
 * root origin, the exposure's scope, the caller's declared capabilities, and
 * the caller's official status in the composition.
 */

/** The only policy language version this registry evaluates. */
export const EXPOSED_API_POLICY_VERSION = 1;

/** Largest accepted canonical policy size in bytes. */
export const EXPOSED_API_MAX_POLICY_BYTES = 65_536;

/** A validated Layer 1 policy. */
export interface ExposedApiPolicy {
  /** Policy language version. */
  readonly policyVersion: typeof EXPOSED_API_POLICY_VERSION;

  /** Root origins admitted, inside what the scope already admits. */
  readonly origins?: readonly CallOrigin[];

  /** Identity classes admitted. */
  readonly callerClasses?: readonly CallerClass[];

  /** Capabilities the caller must have declared. Every one is required. */
  readonly capabilities?: readonly string[];

  /** Official status the caller must hold in this composition. */
  readonly official?: boolean;
}

/** Outcome of one Layer 1 evaluation. */
export type ExposedApiPolicyDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

const POLICY_KEYS = new Set([
  'policyVersion',
  'origins',
  'callerClasses',
  'capabilities',
  'official',
]);

function stringList<T extends string>(
  value: unknown,
  field: string,
  accept: (item: string) => item is T,
): readonly T[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ExposedApiInvalidPolicyError(`${field} must be a non-empty array`);
  }

  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item !== 'string' || !accept(item)) {
      throw new ExposedApiInvalidPolicyError(`${field} contains an unsupported value`);
    }

    if (seen.has(item)) {
      throw new ExposedApiInvalidPolicyError(`${field} contains a duplicate value`);
    }

    seen.add(item);
  }

  return Object.freeze([...seen] as T[]);
}

function isOrigin(value: string): value is CallOrigin {
  return (CALL_ORIGINS as readonly string[]).includes(value);
}

function isCallerClass(value: string): value is CallerClass {
  return (CALLER_CLASSES as readonly string[]).includes(value);
}

function isCapability(value: string): value is string {
  return isCapabilityToken(value);
}

/**
 * Validates and freezes a Layer 1 policy declaration.
 *
 * An omitted policy is the empty version-1 policy: the exposure's scope alone
 * decides reachability.
 *
 * @param value - Declared policy, or `undefined`.
 * @throws {ExposedApiInvalidPolicyError} When the declaration is not a valid
 * version-1 policy.
 */
export function parseExposedApiPolicy(value: unknown): ExposedApiPolicy {
  if (value === undefined) {
    return Object.freeze({ policyVersion: EXPOSED_API_POLICY_VERSION });
  }

  let record: Readonly<Record<string, unknown>>;

  try {
    record = cloneJsonRecord(value);

    if (Buffer.byteLength(canonicalJson(record), 'utf8') > EXPOSED_API_MAX_POLICY_BYTES) {
      throw new ExposedApiInvalidPolicyError(
        `must be at most ${String(EXPOSED_API_MAX_POLICY_BYTES)} canonical bytes`,
      );
    }
  } catch (error: unknown) {
    if (error instanceof ExposedApiInvalidPolicyError) {
      throw error;
    }

    throw new ExposedApiInvalidPolicyError(
      error instanceof JsonValueError ? error.message : 'must be a JSON object',
    );
  }

  for (const key of Object.keys(record)) {
    if (!POLICY_KEYS.has(key)) {
      throw new ExposedApiInvalidPolicyError(`unknown field "${key}"`);
    }
  }

  if (record.policyVersion !== EXPOSED_API_POLICY_VERSION) {
    throw new ExposedApiInvalidPolicyError(
      `policyVersion must be ${String(EXPOSED_API_POLICY_VERSION)}`,
    );
  }

  const policy: {
    policyVersion: typeof EXPOSED_API_POLICY_VERSION;
    origins?: readonly CallOrigin[];
    callerClasses?: readonly CallerClass[];
    capabilities?: readonly string[];
    official?: boolean;
  } = { policyVersion: EXPOSED_API_POLICY_VERSION };

  if (record.origins !== undefined) {
    policy.origins = stringList(record.origins, 'origins', isOrigin);
  }

  if (record.callerClasses !== undefined) {
    policy.callerClasses = stringList(record.callerClasses, 'callerClasses', isCallerClass);
  }

  if (record.capabilities !== undefined) {
    policy.capabilities = stringList(record.capabilities, 'capabilities', isCapability);
  }

  if (record.official !== undefined) {
    if (typeof record.official !== 'boolean') {
      throw new ExposedApiInvalidPolicyError('official must be a boolean');
    }

    policy.official = record.official;
  }

  return Object.freeze(policy);
}

/**
 * Evaluates a Layer 1 policy for one call.
 *
 * Deterministic: the same policy, scope, and kernel-provided context always
 * produce the same decision. Nothing a caller supplies is an input.
 *
 * @param policy - Validated policy.
 * @param scope - The exposure's recorded scope.
 * @param context - The kernel-provided context of the call.
 */
export function evaluateExposedApiPolicy(
  policy: ExposedApiPolicy,
  scope: ExposedApiScope,
  context: KernelCallContext,
): ExposedApiPolicyDecision {
  if (!exposedApiScopeAllowsOrigin(scope, context.origin)) {
    return { allowed: false, reason: `scope "${scope}" does not admit origin "${context.origin}"` };
  }

  if (policy.origins !== undefined && !policy.origins.includes(context.origin)) {
    return { allowed: false, reason: `policy does not admit origin "${context.origin}"` };
  }

  if (
    policy.callerClasses !== undefined
    && !policy.callerClasses.includes(context.caller.callerClass)
  ) {
    return {
      allowed: false,
      reason: `policy does not admit caller class "${context.caller.callerClass}"`,
    };
  }

  if (policy.capabilities !== undefined) {
    const missing = policy.capabilities.filter(
      (capability) => !context.caller.capabilities.has(capability),
    );

    if (missing.length > 0) {
      return { allowed: false, reason: `caller lacks capabilities ${missing.join(', ')}` };
    }
  }

  if (policy.official !== undefined && context.caller.official !== policy.official) {
    return {
      allowed: false,
      reason: `policy requires official status ${String(policy.official)}`,
    };
  }

  return { allowed: true };
}
