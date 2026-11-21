import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { CommandError } from '../../core/errors.js';

/** The composition entry path for an installed package, relative to the composition file, with `/` separators. */
export function entryPath(configPath: string, projectDir: string, name: string): string {
  const rel = relative(dirname(configPath), join(projectDir, 'node_modules', ...name.split('/'), 'brud.participant.json')).split(sep).join('/');

  return rel.startsWith('.') ? rel : `./${rel}`;
}

/**
 * Appends a not-official entry to the composition's "services", keeping every
 * other top-level key. Never sets `official: true`.
 */
export function writeEntry(configPath: string, path: string): 'added' | 'present' {
  const document = JSON.parse(readFileSync(configPath, 'utf8')) as { services?: { path: string; official?: boolean }[] };

  if (!Array.isArray(document.services)) {
    throw new CommandError('CONFIG_SCHEMA', `${configPath} has no "services" array to add to`);
  }

  if (document.services.some((entry) => entry.path === path)) {
    return 'present';
  }

  document.services.push({ path, official: false });
  writeFileSync(configPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

  return 'added';
}
