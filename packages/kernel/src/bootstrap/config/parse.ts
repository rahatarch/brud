import {
  BrudConfigError,
  type BrudConfig,
  type BrudConfigEntry,
} from './types.js';

const ENTRY_KEYS = new Set(['path', 'official']);

/**
 * Parses and validates the kernel-owned section of a `brud.config.json`
 * document.
 *
 * The kernel owns `services`. Other top-level sections belong to the
 * participants that own them; the kernel carries them untouched and never
 * interprets them.
 *
 * @param raw - File contents.
 * @param configPath - Config path used in diagnostics.
 */
export function parseBrudConfig(raw: string, configPath: string): BrudConfig {
  let document: unknown;

  try {
    document = JSON.parse(raw);
  } catch (error: unknown) {
    throw new BrudConfigError(
      'CONFIG_PARSE',
      `Config is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      configPath,
    );
  }

  if (!isRecord(document)) {
    throw new BrudConfigError('CONFIG_SCHEMA', 'Config root must be an object', configPath);
  }

  const services = parseEntries(document.services, 'services', raw, configPath);

  return { services };
}

function parseEntries(
  value: unknown,
  key: 'services',
  raw: string,
  configPath: string,
): readonly BrudConfigEntry[] {
  if (!Array.isArray(value)) {
    throw new BrudConfigError(
      'CONFIG_SCHEMA',
      `Config "${key}" must be an array`,
      configPath,
      lineOf(raw, key),
    );
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new BrudConfigError(
        'CONFIG_SCHEMA',
        `Config ${key}[${String(index)}] must be an object`,
        configPath,
        lineOf(raw, key),
      );
    }

    for (const entryKey of Object.keys(entry)) {
      if (!ENTRY_KEYS.has(entryKey)) {
        throw new BrudConfigError(
          'CONFIG_SCHEMA',
          `Config ${key}[${String(index)}] contains unknown key "${entryKey}"`,
          configPath,
          lineOf(raw, entryKey),
        );
      }
    }

    const path = entry.path;

    if (typeof path !== 'string' || path.trim() === '') {
      throw new BrudConfigError(
        'CONFIG_SCHEMA',
        `Config ${key}[${String(index)}].path must be a non-empty string`,
        configPath,
        lineOf(raw, key),
      );
    }

    const official = entry.official;

    if (official !== undefined && typeof official !== 'boolean') {
      throw new BrudConfigError(
        'CONFIG_SCHEMA',
        `Config ${key}[${String(index)}].official must be a boolean`,
        configPath,
        lineOf(raw, path),
      );
    }

    return official === undefined ? { path } : { path, official };
  });
}

/** Finds the first source line containing a token. */
export function lineOf(raw: string, token: string): number | undefined {
  const lines = raw.split('\n');
  const needle = JSON.stringify(token);
  const index = lines.findIndex(
    (line) => line.includes(needle) || line.includes(`"${token}"`),
  );

  return index < 0 ? undefined : index + 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}