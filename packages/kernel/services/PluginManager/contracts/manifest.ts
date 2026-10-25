import { hasOfficialPluginBrand, isReservedPluginId } from './branding.js';
import { isPluginPermission } from './permissions.js';
import type { PluginPermission } from './permissions.js';

/** Fields shared by every plugin manifest. */
export interface PluginManifestBase {
  /**
   * Stable plugin identifier.
   *
   * Accepts reverse-DNS (`acme.tools.core`) or kebab-case (`acme-tools-core`)
   * form. Identifiers are lowercase and segments are separated by a single
   * `.` or `-`. The `brud.` and `@brud/` prefixes are reserved for certified
   * first-party plugins.
   */
  readonly id: string;

  /** Human-readable plugin name. */
  readonly name: string;

  /** Semantic version of the plugin, for example `1.4.0` or `2.0.0-beta.1`. */
  readonly version: string;

  /** Optional human-readable description. */
  readonly description?: string;

  /** Identifiers of plugins that must activate before this one. */
  readonly dependencies?: readonly string[];

  /** Capabilities this plugin declares. */
  readonly permissions: readonly PluginPermission[];
}

/**
 * Manifest declared by a third-party plugin.
 *
 * Third-party manifests cannot assert official status; the optional field only
 * accepts `false` so an attempt to claim certification fails at type level.
 */
export interface ThirdPartyPluginManifest extends PluginManifestBase {
  /** Explicitly non-official marker. */
  readonly official?: false;
}

/**
 * Manifest declared by a certified first-party plugin.
 *
 * A value of this type still requires the internal kernel brand at runtime;
 * the type alone is not an authorization mechanism.
 */
export interface OfficialPluginManifest extends PluginManifestBase {
  /** Official plugin indicator. */
  readonly official: true;
}

/**
 * Declarative description of a plugin, supplied by the plugin author.
 *
 * Manifests are untrusted input: they must be validated with
 * {@link validatePluginManifest} before registration.
 */
export type PluginManifest = ThirdPartyPluginManifest | OfficialPluginManifest;

/**
 * Reason a manifest validation failed.
 *
 * Authorization reasons are reported separately so orchestrators can raise a
 * dedicated security error instead of a generic manifest error.
 */
export type PluginManifestValidationFailureReason =
  | 'INVALID_MANIFEST'
  | 'RESERVED_NAMESPACE'
  | 'OFFICIAL_STATUS';

/** Options that carry internal evidence for official manifest claims. */
export interface PluginManifestValidationOptions {
  /**
   * Object expected to carry the internal official brand symbol.
   *
   * Kernel callers pass the plugin instance. Third-party callers omit this
   * option and therefore cannot validate a reserved identifier or an official
   * flag.
   */
  readonly officialBrandHolder?: object;
}

/** Successful manifest validation outcome. */
export interface PluginManifestValidationSuccess {
  readonly ok: true;
  readonly manifest: PluginManifest;
}

/** Failed manifest validation outcome. */
export interface PluginManifestValidationFailure {
  readonly ok: false;
  readonly reason: PluginManifestValidationFailureReason;
  readonly error: string;
}

/** Result of validating an untrusted manifest candidate. */
export type PluginManifestValidationResult =
  | PluginManifestValidationSuccess
  | PluginManifestValidationFailure;

/** Lowercase, dot- or kebab-separated plugin identifier. */
export const PLUGIN_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/**
 * Semantic Versioning 2.0.0 pattern, including optional pre-release and build
 * metadata.
 */
export const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** Internal success branch for a single validated field. */
interface FieldSuccess<TValue> {
  readonly ok: true;
  readonly value: TValue;
}

/** Internal failure branch for a single validated field. */
interface FieldFailure {
  readonly ok: false;
  readonly error: string;
}

/** Internal outcome of validating a single manifest field. */
type FieldResult<TValue> = FieldSuccess<TValue> | FieldFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateId(candidate: unknown, field: string): FieldResult<string> {
  if (typeof candidate !== 'string') {
    return { ok: false, error: `manifest.${field} must be a string` };
  }

  if (!PLUGIN_ID_PATTERN.test(candidate)) {
    return {
      ok: false,
      error: `manifest.${field} must be a lowercase dot- or kebab-separated identifier (received "${candidate}")`,
    };
  }

  return { ok: true, value: candidate };
}

function validateName(candidate: unknown): FieldResult<string> {
  if (typeof candidate !== 'string') {
    return { ok: false, error: 'manifest.name must be a string' };
  }

  if (candidate.trim().length === 0) {
    return { ok: false, error: 'manifest.name must be a non-empty string' };
  }

  return { ok: true, value: candidate };
}

function validateVersion(candidate: unknown): FieldResult<string> {
  if (typeof candidate !== 'string') {
    return { ok: false, error: 'manifest.version must be a string' };
  }

  if (!SEMVER_PATTERN.test(candidate)) {
    return {
      ok: false,
      error: `manifest.version must be a valid semantic version (received "${candidate}")`,
    };
  }

  return { ok: true, value: candidate };
}

function validateOfficial(candidate: unknown): FieldResult<boolean | undefined> {
  if (candidate === undefined) {
    return { ok: true, value: undefined };
  }

  if (typeof candidate !== 'boolean') {
    return { ok: false, error: 'manifest.official must be a boolean when provided' };
  }

  return { ok: true, value: candidate };
}

function validateDescription(candidate: unknown): FieldResult<string | undefined> {
  if (candidate === undefined) {
    return { ok: true, value: undefined };
  }

  if (typeof candidate !== 'string') {
    return { ok: false, error: 'manifest.description must be a string when provided' };
  }

  if (candidate.trim().length === 0) {
    return { ok: false, error: 'manifest.description must be a non-empty string when provided' };
  }

  return { ok: true, value: candidate };
}

function validateDependencies(
  candidate: unknown,
  pluginId: string,
): FieldResult<readonly string[] | undefined> {
  if (candidate === undefined) {
    return { ok: true, value: undefined };
  }

  if (!Array.isArray(candidate)) {
    return {
      ok: false,
      error: 'manifest.dependencies must be an array of plugin identifiers when provided',
    };
  }

  const dependencies: string[] = [];
  const seen = new Set<string>();

  for (const entry of candidate) {
    const result = validateId(entry, 'dependencies[]');
    if (!result.ok) {
      return result;
    }

    if (result.value === pluginId) {
      return {
        ok: false,
        error: `manifest.dependencies must not include the plugin itself ("${pluginId}")`,
      };
    }

    if (seen.has(result.value)) {
      return {
        ok: false,
        error: `manifest.dependencies must not contain duplicate plugin identifier "${result.value}"`,
      };
    }

    seen.add(result.value);
    dependencies.push(result.value);
  }

  return { ok: true, value: dependencies };
}

function validatePermissions(candidate: unknown): FieldResult<readonly PluginPermission[]> {
  if (candidate === undefined) {
    return { ok: false, error: 'manifest.permissions is required' };
  }

  if (!Array.isArray(candidate)) {
    return { ok: false, error: 'manifest.permissions must be an array' };
  }

  const permissions: PluginPermission[] = [];
  const seen = new Set<PluginPermission>();

  for (const entry of candidate) {
    if (!isPluginPermission(entry)) {
      return {
        ok: false,
        error: `manifest.permissions contains an unknown permission: ${JSON.stringify(entry)}`,
      };
    }

    if (seen.has(entry)) {
      return {
        ok: false,
        error: `manifest.permissions must not contain duplicate permission "${entry}"`,
      };
    }

    seen.add(entry);
    permissions.push(entry);
  }

  return { ok: true, value: permissions };
}

/**
 * Validates an untrusted manifest candidate without mutating it.
 *
 * The returned manifest is a defensive copy: later mutation of the input
 * object or its arrays cannot affect the validated result.
 *
 * Authorization failures for reserved namespaces and official claims are
 * reported with a dedicated reason so callers can raise a security error.
 *
 * @param candidate - Value sourced from disk, a registry, or a plugin package.
 * @param options - Internal evidence of official certification, when available.
 * @returns A discriminated result carrying either the normalized manifest or a
 * deterministic validation error.
 */
export function validatePluginManifest(
  candidate: unknown,
  options?: PluginManifestValidationOptions,
): PluginManifestValidationResult {
  if (!isRecord(candidate)) {
    return { ok: false, reason: 'INVALID_MANIFEST', error: 'manifest must be a non-null object' };
  }

  const branded =
    options?.officialBrandHolder !== undefined &&
    hasOfficialPluginBrand(options.officialBrandHolder);

  const official = validateOfficial(candidate.official);
  if (!official.ok) {
    return { ok: false, reason: 'INVALID_MANIFEST', error: official.error };
  }

  const rawId = candidate.id;

  if (typeof rawId === 'string' && isReservedPluginId(rawId) && !branded) {
    return {
      ok: false,
      reason: 'RESERVED_NAMESPACE',
      error: `manifest.id "${rawId}" uses the reserved official namespace without official plugin branding`,
    };
  }

  if (official.value === true && !branded) {
    return {
      ok: false,
      reason: 'OFFICIAL_STATUS',
      error: 'manifest.official requires official plugin branding',
    };
  }

  const id = validateId(rawId, 'id');
  if (!id.ok) {
    return { ok: false, reason: 'INVALID_MANIFEST', error: id.error };
  }

  const name = validateName(candidate.name);
  if (!name.ok) {
    return { ok: false, reason: 'INVALID_MANIFEST', error: name.error };
  }

  const version = validateVersion(candidate.version);
  if (!version.ok) {
    return { ok: false, reason: 'INVALID_MANIFEST', error: version.error };
  }

  const description = validateDescription(candidate.description);
  if (!description.ok) {
    return { ok: false, reason: 'INVALID_MANIFEST', error: description.error };
  }

  const dependencies = validateDependencies(candidate.dependencies, id.value);
  if (!dependencies.ok) {
    return { ok: false, reason: 'INVALID_MANIFEST', error: dependencies.error };
  }

  const permissions = validatePermissions(candidate.permissions);
  if (!permissions.ok) {
    return { ok: false, reason: 'INVALID_MANIFEST', error: permissions.error };
  }

  const base: PluginManifestBase = {
    id: id.value,
    name: name.value,
    version: version.value,
    permissions: [...permissions.value],
    ...(description.value === undefined ? {} : { description: description.value }),
    ...(dependencies.value === undefined
      ? {}
      : { dependencies: [...dependencies.value] }),
  };

  if (official.value === true) {
    const officialManifest: OfficialPluginManifest = { ...base, official: true };

    return { ok: true, manifest: officialManifest };
  }

  const thirdPartyManifest: ThirdPartyPluginManifest =
    official.value === false ? { ...base, official: false } : base;

  return { ok: true, manifest: thirdPartyManifest };
}
