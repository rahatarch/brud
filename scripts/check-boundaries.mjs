import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(new URL('../', import.meta.url).pathname);
const PLUGINS_ROOT = join(REPO_ROOT, 'packages', 'plugins');

/**
 * Roots that no leaf plugin may reach through a relative import. The legacy
 * engine and adapter were quarantined to `deprecated/` in Phase 11 (D-14/D-17),
 * so reaching either the archive or the editor layer is a boundary violation.
 */
const FORBIDDEN_ROOTS = [
  join(REPO_ROOT, 'apps'),
  join(REPO_ROOT, 'deprecated'),
  join(REPO_ROOT, 'packages', 'adapters'),
  join(REPO_ROOT, 'packages', 'core'),
];
const FORBIDDEN_SPECIFIERS = new Set([
  'vscode',
  '@brud/core',
  '@brud/mcp',
  '@brud/vscode-adapter',
]);
const IMPORT_PATTERN = /(?:from\s+|require\()\s*['"]([^'"]+)['"]/g;

function walk(directory) {
  const entries = [];
  for (const name of readdirSync(directory)) {
    const full = join(directory, name);
    if (statSync(full).isDirectory()) {
      if (name !== '__tests__' && name !== 'dist' && name !== 'node_modules') {
        entries.push(...walk(full));
      }
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
      entries.push(full);
    }
  }
  return entries;
}

function pluginDirectories() {
  return readdirSync(PLUGINS_ROOT)
    .map((name) => join(PLUGINS_ROOT, name))
    .filter((full) => statSync(full).isDirectory() && statSync(join(full, 'src')).isDirectory())
    .sort();
}

function isForbidden(specifier, file, packageRoot) {
  if (FORBIDDEN_SPECIFIERS.has(specifier)) {
    return true;
  }

  if (specifier === 'deprecated' || specifier.startsWith('deprecated/')) {
    return true;
  }

  if (!specifier.startsWith('.')) {
    return false;
  }

  const resolvedImport = resolve(dirname(file), specifier);

  if (FORBIDDEN_ROOTS.some((root) => resolvedImport === root || resolvedImport.startsWith(root + '/'))) {
    return true;
  }

  return !(resolvedImport === packageRoot || resolvedImport.startsWith(packageRoot + '/'));
}

const violations = [];
const plugins = pluginDirectories();

for (const packageRoot of plugins) {
  const sourceRoot = join(packageRoot, 'src');

  for (const file of walk(sourceRoot)) {
    const contents = readFileSync(file, 'utf8');
    const pattern = new RegExp(IMPORT_PATTERN.source, 'g');
    let match;

    while ((match = pattern.exec(contents)) !== null) {
      if (isForbidden(match[1], file, packageRoot)) {
        violations.push(`${relative(REPO_ROOT, file)} imports "${match[1]}"`);
      }
    }
  }
}

if (plugins.length === 0) {
  process.stderr.write('No plugin packages were found under packages/plugins.\n');
  process.exit(1);
}

if (violations.length > 0) {
  process.stderr.write('Leaf plugins must not depend on the editor, legacy engine, or archive layers:\n');
  for (const violation of violations) {
    process.stderr.write(`  ${violation}\n`);
  }
  process.exit(1);
}

process.stdout.write(`Plugin boundaries: ok (${String(plugins.length)} plugins scanned)\n`);