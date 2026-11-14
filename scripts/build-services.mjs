#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const servicesRoot = join(repositoryRoot, 'packages', 'services');
const sharedDist = join(servicesRoot, 'dist');
const tsc = join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc');

const dirToPackage = {
  ActionManager: '@brud/service-actions',
  BrandRegistry: '@brud/service-brand-registry',
  BrudFileSystem: '@brud/service-filesystem',
  BrudTools: '@brud/service-tools',
  PluginManager: '@brud/service-plugin-manager',
  SettingsService: '@brud/service-settings',
  TerminalService: '@brud/service-terminal',
  UniversalHistory: '@brud/service-history',
  UtilityService: '@brud/service-utility',
  ValidationService: '@brud/service-validation',
  WorkspaceService: '@brud/service-workspace',
};

function walk(directory, out = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);

    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }

  return out;
}

/**
 * Rewrites relative cross-package imports in the shared build into package
 * specifiers. Source keeps relative imports so tests share module instances;
 * the shipped packages use their published names.
 */
function rewritePackageSpecifiers() {
  const pattern = /(from\s+|import\s*\(\s*|require\s*\(\s*|^\s*import\s+)(['"])(\.[^'"]*)\2/gm;

  for (const file of walk(sharedDist)) {
    const currentDirectory = relative(sharedDist, file).split(sep)[0];
    let contents = readFileSync(file, 'utf8');
    let changed = false;

    contents = contents.replace(pattern, (whole, lead, quote, specifier) => {
      const target = resolve(dirname(file), specifier);
      const rel = relative(sharedDist, target).replaceAll('\\', '/');
      const [targetDirectory, ...rest] = rel.split('/');
      const packageName = dirToPackage[targetDirectory];

      if (
        packageName === undefined
        || targetDirectory === currentDirectory
        || rest.length === 0
      ) {
        return whole;
      }

      changed = true;

      return `${lead}${quote}${packageName}/${rest.join('/')}${quote}`;
    });

    if (changed) {
      writeFileSync(file, contents, 'utf8');
    }
  }
}

for (const entry of readdirSync(servicesRoot)) {
  const packageDir = join(servicesRoot, entry);

  if (statSync(packageDir).isDirectory()) {
    rmSync(join(packageDir, 'dist'), { recursive: true, force: true });
  }
}

rmSync(sharedDist, { recursive: true, force: true });

execFileSync(process.execPath, [tsc, '-p', join(servicesRoot, 'tsconfig.json')], {
  stdio: 'inherit',
  cwd: repositoryRoot,
});

rewritePackageSpecifiers();

const outcomes = [];

for (const entry of readdirSync(servicesRoot)) {
  const packageDir = join(servicesRoot, entry);

  if (!statSync(packageDir).isDirectory()) {
    continue;
  }

  if (!existsSync(join(packageDir, 'package.json'))) {
    continue;
  }

  const built = join(sharedDist, entry);

  if (!existsSync(built)) {
    continue;
  }

  cpSync(built, join(packageDir, 'dist'), { recursive: true });
  outcomes.push(entry);
}

rmSync(sharedDist, { recursive: true, force: true });

process.stdout.write(`Built ${String(outcomes.length)} service packages: ${outcomes.join(', ')}\n`);
