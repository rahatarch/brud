import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BrudConfigError } from '@brud/kernel';
import type { IBrudPlugin } from './contracts/IBrudPlugin.js';

/** One plugin entry the host composition declares. */
export interface PluginConfigEntry {
  /** Module path, package name, `file:` URL, or config-relative path. */
  readonly path: string;

  /** Whether the composition declared the plugin official. */
  readonly official?: boolean;
}

/** Plugins loaded from one composition config. */
export interface LoadedConfiguredPlugins {
  readonly plugins: readonly IBrudPlugin[];
  readonly officialPlugins: readonly object[];
}

/**
 * Loads the plugins a composition config declares.
 *
 * Plugin loading belongs to the plugin manager. The kernel does not read the
 * plugin section and does not define what a plugin is. The host points the
 * manager at the composition document through the manager's own context
 * namespace.
 *
 * @param configPath - Composition document the host supplied.
 */
export async function loadConfiguredPlugins(
  configPath: string,
): Promise<LoadedConfiguredPlugins> {
  let raw: string;

  try {
    raw = await readFile(configPath, 'utf8');
  } catch (error: unknown) {
    throw new BrudConfigError(
      'CONFIG_READ',
      `Cannot read config: ${error instanceof Error ? error.message : String(error)}`,
      configPath,
    );
  }

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

  const declared = document.plugins;

  if (declared === undefined) {
    return { plugins: [], officialPlugins: [] };
  }

  if (!Array.isArray(declared)) {
    throw new BrudConfigError(
      'CONFIG_SCHEMA',
      'Config "plugins" must be an array',
      configPath,
      lineOf(raw, 'plugins'),
    );
  }

  const entries = declared.map((entry, index) =>
    pluginEntry(entry, index, raw, configPath));
  const plugins: IBrudPlugin[] = [];
  const officialPlugins: IBrudPlugin[] = [];

  for (const [index, entry] of entries.entries()) {
    const moduleValue = await importPluginModule(entry.path, configPath, raw, index);
    const plugin = extractPlugin(moduleValue);

    if (plugin === undefined) {
      throw new BrudConfigError(
        'MODULE_CONTRACT',
        `Plugin module "${entry.path}" (plugins[${String(index)}]) must export a plugin`,
        configPath,
        lineOf(raw, entry.path),
      );
    }

    plugins.push(plugin);

    if (entry.official === true) {
      officialPlugins.push(plugin);
    }
  }

  return { plugins, officialPlugins };
}

function pluginEntry(
  value: unknown,
  index: number,
  raw: string,
  configPath: string,
): PluginConfigEntry {
  if (!isRecord(value)) {
    throw new BrudConfigError(
      'CONFIG_SCHEMA',
      `Config plugins[${String(index)}] must be an object`,
      configPath,
      lineOf(raw, 'plugins'),
    );
  }

  for (const key of Object.keys(value)) {
    if (key !== 'path' && key !== 'official') {
      throw new BrudConfigError(
        'CONFIG_SCHEMA',
        `Config plugins[${String(index)}] contains unknown key "${key}"`,
        configPath,
        lineOf(raw, key),
      );
    }
  }

  const path = value.path;

  if (typeof path !== 'string' || path.trim() === '') {
    throw new BrudConfigError(
      'CONFIG_SCHEMA',
      `Config plugins[${String(index)}].path must be a non-empty string`,
      configPath,
      lineOf(raw, 'plugins'),
    );
  }

  const official = value.official;

  if (official !== undefined && typeof official !== 'boolean') {
    throw new BrudConfigError(
      'CONFIG_SCHEMA',
      `Config plugins[${String(index)}].official must be a boolean`,
      configPath,
      lineOf(raw, path),
    );
  }

  return official === undefined ? { path } : { path, official };
}

async function importPluginModule(
  declaredPath: string,
  configPath: string,
  raw: string,
  index: number,
): Promise<unknown> {
  const id = resolvePluginId(declaredPath, configPath);

  try {
    return await import(
      id.startsWith('file:') || isAbsolute(id) ? pathToFileURL(id).href : id
    );
  } catch (error: unknown) {
    throw new BrudConfigError(
      'MODULE_RESOLVE',
      `Cannot resolve module "${declaredPath}" (plugins[${String(index)}]): ${error instanceof Error ? error.message : String(error)}`,
      configPath,
      lineOf(raw, declaredPath),
    );
  }
}

function resolvePluginId(declaredPath: string, configPath: string): string {
  if (declaredPath.startsWith('file:')) {
    return fileURLToPath(declaredPath);
  }

  if (isAbsolute(declaredPath)) {
    return declaredPath;
  }

  if (declaredPath.startsWith('./') || declaredPath.startsWith('../')) {
    return resolve(dirname(configPath), declaredPath);
  }

  return declaredPath;
}

function extractPlugin(moduleValue: unknown): IBrudPlugin | undefined {
  if (!isRecord(moduleValue)) {
    return undefined;
  }

  if (isPlugin(moduleValue.default)) {
    return moduleValue.default;
  }

  if (isPlugin(moduleValue.plugin)) {
    return moduleValue.plugin;
  }

  const candidates = Object.values(moduleValue).filter(isPlugin);

  return candidates.length === 1 ? candidates[0] : undefined;
}

function isPlugin(value: unknown): value is IBrudPlugin {
  return isRecord(value) && isRecord(value.manifest) && typeof value.activate === 'function';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function lineOf(raw: string, token: string): number | undefined {
  const lines = raw.split('\n');
  const needle = JSON.stringify(token);
  const index = lines.findIndex(
    (line) => line.includes(needle) || line.includes(`"${token}"`),
  );

  return index < 0 ? undefined : index + 1;
}