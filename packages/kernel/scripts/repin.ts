// Re-pins the hardcores: runs each service's pre-pin hook
// (services/<name>/scripts/prepin.ts, e.g. a generated digest table), then
// recomputes every hardcore's source and built content pins in
// src/bootstrap/hardcoreServices.ts. Hardcores are discovered from
// serviceModules/; a pin constant is the module name in UPPER_SNAKE_CASE.
//
//   node --import tsx scripts/repin.ts          run hooks, write pins, rebuild dist/
//   node --import tsx scripts/repin.ts --check  fail if anything is stale (CI, prepack)
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computePackageContentHash } from '../src/bootstrap/hardcore.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const pinsFile = join(root, 'src/bootstrap/hardcoreServices.ts');
const hardcores = readdirSync(join(root, 'serviceModules'))
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts'))
  .map((name) => name.slice(0, -'.ts'.length))
  .sort();
const stale: string[] = [];

function runHooks(): void {
  for (const service of readdirSync(join(root, 'services')).sort()) {
    const hook = join(root, 'services', service, 'scripts', 'prepin.ts');

    if (!existsSync(hook)) {
      continue;
    }

    const result = spawnSync(process.execPath, ['--import', 'tsx', hook, ...(check ? ['--check'] : [])], { stdio: 'inherit' });

    if (result.status !== 0) {
      stale.push(`pre-pin hook of ${service}`);
    }
  }
}

function update(file: string, label: string, next: string): void {
  if (readFileSync(file, 'utf8') === next) {
    return;
  }

  stale.push(label);

  if (!check) {
    writeFileSync(file, next, 'utf8');
  }
}

function setPin(source: string, constant: string, value: string): string {
  const pattern = new RegExp(`(const ${constant} =\\s*')[0-9a-f]{64}(')`, 'u');

  if (!pattern.test(source)) {
    throw new Error(`pin ${constant} not found in hardcoreServices.ts`);
  }

  return source.replace(pattern, `$1${value}$2`);
}

function repin(kind: 'SOURCE' | 'BUILT'): void {
  let source = readFileSync(pinsFile, 'utf8');

  for (const name of hardcores) {
    const prefix = name.replace(/([a-z0-9])([A-Z])/gu, '$1_$2').toUpperCase();
    const entry = kind === 'SOURCE'
      ? join(root, 'serviceModules', `${name}.ts`)
      : join(root, 'dist/serviceModules', `${name}.js`);

    if (kind === 'BUILT' && !existsSync(entry)) {
      throw new Error(`${entry} is missing; build dist/ first`);
    }

    source = setPin(source, `${prefix}_${kind}_HASH`, computePackageContentHash(entry));
  }

  update(pinsFile, `${kind.toLowerCase()} pins`, source);
}

function build(): void {
  const result = spawnSync(process.execPath, [createRequire(import.meta.url).resolve('typescript/bin/tsc'), '-p', join(root, 'tsconfig.json')], { stdio: 'inherit' });

  if (result.status !== 0) {
    throw new Error('tsc failed');
  }
}

runHooks();
repin('SOURCE');

if (!check) {
  build();
}

repin('BUILT');

if (!check) {
  build();
}

if (check && stale.length > 0) {
  console.error(`stale: ${stale.join(', ')}; run \`node --import tsx scripts/repin.ts\``);
  process.exit(1);
}

console.log(check ? 'pins: up to date' : `pins: ${stale.length === 0 ? 'unchanged' : `updated ${stale.join(', ')}`}`);
