import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { DaemonCallerTier } from '@brud/protocol';

/**
 * Operator-owned daemon configuration, read once at start and frozen.
 *
 * The daemon knows no participant and no domain concept. Everything a kernel
 * needs comes from here (the operator) or from the client, and the operator
 * decides which startup fields a client may set.
 */
export interface DaemonOperatorConfig {
  /** Absolute path of the composition (`brud.config.json`) every kernel boots. */
  readonly composition: string;
  /** Startup options fixed by the operator; a client can never override them. */
  readonly fixedOptions: Readonly<Record<string, unknown>>;
  /** Startup field names a client may set in `kernel.boot`. */
  readonly clientOptions: readonly string[];
  /** Host-session capabilities per authenticated principal. */
  readonly principals: Readonly<Record<DaemonCallerTier, readonly string[]>>;
  /** Reuse a running kernel when a boot request carries identical options. */
  readonly reuseIdenticalBoots: boolean;
}

/** Raised when the operator config file is missing or malformed. */
export class OperatorConfigError extends Error {
  readonly code = 'DAEMON_OPERATOR_CONFIG_INVALID';

  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = 'OperatorConfigError';
  }
}

/** File name of the operator config inside the daemon home. */
export const OPERATOR_CONFIG_FILE = 'daemon.json';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringList(value: unknown, field: string): readonly string[] {
  if (value === undefined) {
    return Object.freeze([]);
  }

  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new OperatorConfigError(`${field} must be an array of strings`);
  }

  return Object.freeze([...value]);
}

/**
 * Parses an operator config value. Relative composition paths resolve against
 * the config file's folder.
 */
export function parseOperatorConfig(value: unknown, configPath: string): DaemonOperatorConfig {
  if (!isRecord(value)) {
    throw new OperatorConfigError(`${configPath} must contain a JSON object`);
  }

  const known = new Set(['composition', 'fixedOptions', 'clientOptions', 'principals', 'reuseIdenticalBoots']);

  for (const key of Object.keys(value)) {
    if (!known.has(key)) {
      throw new OperatorConfigError(`${configPath}: unknown key "${key}"`);
    }
  }

  if (typeof value.composition !== 'string' || value.composition.length === 0) {
    throw new OperatorConfigError(`${configPath}: composition must be a path to a brud.config.json`);
  }

  if (value.fixedOptions !== undefined && !isRecord(value.fixedOptions)) {
    throw new OperatorConfigError(`${configPath}: fixedOptions must be an object`);
  }

  const principals = value.principals === undefined ? {} : value.principals;

  if (!isRecord(principals)) {
    throw new OperatorConfigError(`${configPath}: principals must be an object`);
  }

  if (value.reuseIdenticalBoots !== undefined && typeof value.reuseIdenticalBoots !== 'boolean') {
    throw new OperatorConfigError(`${configPath}: reuseIdenticalBoots must be a boolean`);
  }

  const composition = isAbsolute(value.composition)
    ? value.composition
    : resolve(dirname(configPath), value.composition);

  return Object.freeze({
    composition,
    fixedOptions: Object.freeze({ ...(value.fixedOptions ?? {}) }),
    clientOptions: stringList(value.clientOptions, 'clientOptions'),
    principals: Object.freeze({
      ui: stringList(principals.ui, 'principals.ui'),
      ai: stringList(principals.ai, 'principals.ai'),
    }),
    reuseIdenticalBoots: value.reuseIdenticalBoots ?? false,
  });
}

/** Reads `<home>/daemon.json` (or an explicit path). */
export function loadOperatorConfig(home: string, explicitPath?: string): DaemonOperatorConfig {
  const configPath = explicitPath ?? join(home, OPERATOR_CONFIG_FILE);
  let raw: string;

  try {
    raw = readFileSync(configPath, 'utf8');
  } catch (error: unknown) {
    throw new OperatorConfigError(`Cannot read the daemon operator config at ${configPath}`, { cause: error });
  }

  try {
    return parseOperatorConfig(JSON.parse(raw), configPath);
  } catch (error: unknown) {
    if (error instanceof OperatorConfigError) {
      throw error;
    }

    throw new OperatorConfigError(`${configPath} is not valid JSON`, { cause: error });
  }
}
