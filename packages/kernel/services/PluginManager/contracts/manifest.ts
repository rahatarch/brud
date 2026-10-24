import { isPluginPermission } from './permissions.js';
import type { PluginPermission } from './permissions.js';

/**
 * Declarative description of a plugin, supplied by the plugin author.
 *
 * Manifests are untrusted input: they must be validated with
 * {@link validatePluginManifest} before registration.
 */
export interface PluginManifest {
  /**
   * Stable plugin identifier.
   *
   * Accepts reverse-DNS (`brud.tools.core`) or kebab-case (`brud-tools-core`)
   * form. Identifiers are lowercase and segments are separated by a single
   * `.` or `-`.
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

/** Successful manifest validation outcome. */
export interface PluginManifestValidationSuccess {
  readonly ok: true;
  readonly manifest: PluginManifest;
}

/** Failed manifest validation outcome. */
export interface PluginManifestValidationFailure {
  readonly ok: false;
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
 * @param candidate - Value sourced from disk, a registry, or a plugin package.
 * @returns A discriminated result carrying either the normalized manifest or a
 * deterministic validation error.
 */
export function validatePluginManifest(candidate: unknown): PluginManifestValidationResult {
  if (!isRecord(candidate)) {
    return { ok: false, error: 'manifest must be a non-null object' };
  }

  const id = validateId(candidate.id, 'id');
  if (!id.ok) {
    return id;
  }

  const name = validateName(candidate.name);
  if (!name.ok) {
    return name;
  }

  const version = validateVersion(candidate.version);
  if (!version.ok) {
    return version;
  }

  const description = validateDescription(candidate.description);
  if (!description.ok) {
    return description;
  }

  const dependencies = validateDependencies(candidate.dependencies, id.value);
  if (!dependencies.ok) {
    return dependencies;
  }

  const permissions = validatePermissions(candidate.permissions);
  if (!permissions.ok) {
    return permissions;
  }

  return {
    ok: true,
    manifest: {
      id: id.value,
      name: name.value,
      version: version.value,
      permissions: [...permissions.value],
      ...(description.value === undefined ? {} : { description: description.value }),
      ...(dependencies.value === undefined
        ? {}
        : { dependencies: [...dependencies.value] }),
    },
  };
}
