import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const PACKAGE_ROOT = resolve(new URL('../packages/mcp/src', import.meta.url).pathname);
const REPO_ROOT = resolve(new URL('../', import.meta.url).pathname);
const FORBIDDEN_ROOTS = [join(REPO_ROOT, 'apps'), join(REPO_ROOT, 'packages', 'adapters')];
const IMPORT_PATTERN = /(?:from\s+|require\()\s*['"]([^'"]+)['"]/g;

function walk(directory) {
  const entries = [];
  for (const name of readdirSync(directory)) {
    const full = join(directory, name);
    if (statSync(full).isDirectory()) {
      entries.push(...walk(full));
    } else if (name.endsWith('.ts')) {
      entries.push(full);
    }
  }
  return entries;
}

function isForbidden(specifier, file) {
  if (specifier === 'vscode' || specifier === '@brud/vscode-adapter') {
    return true;
  }
  if (!specifier.startsWith('.')) {
    return false;
  }
  const resolvedImport = resolve(dirname(file), specifier);
  if (FORBIDDEN_ROOTS.some((root) => resolvedImport === root || resolvedImport.startsWith(root + '/'))) {
    return true;
  }
  return !(resolvedImport === PACKAGE_ROOT || resolvedImport.startsWith(PACKAGE_ROOT + '/'));
}

const violations = [];

for (const file of walk(PACKAGE_ROOT)) {
  const contents = readFileSync(file, 'utf8');
  const pattern = new RegExp(IMPORT_PATTERN.source, 'g');
  let match;
  while ((match = pattern.exec(contents)) !== null) {
    if (isForbidden(match[1], file)) {
      violations.push(`${relative(REPO_ROOT, file)} imports "${match[1]}"`);
    }
  }
}

if (violations.length > 0) {
  process.stderr.write('MCP package must not depend on the editor layer:\n');
  for (const violation of violations) {
    process.stderr.write(`  ${violation}\n`);
  }
  process.exit(1);
}

process.stdout.write('MCP package boundaries: ok\n');
