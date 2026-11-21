import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isValid, majorMinor } from './semver.mjs';

/** The BrudOS packages that are released, as folder names under packages/. */
export const CORE_DIRS = ['protocol', 'kernel', 'sdk', 'daemon'];
export const DEP_FIELDS = ['dependencies', 'peerDependencies', 'devDependencies', 'optionalDependencies'];
export const CONTRACT_FILE = 'packages/sdk/src/core/contract.ts';
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall'];

export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
export const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

/** Every workspace package.json (core, services, plugins, cli, ui...). */
export function loadWorkspaceManifests(root) {
  const manifests = [];
  const groups = ['packages', 'packages/services', 'packages/plugins'];
  for (const group of groups) {
    const base = join(root, group);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = join(base, entry.name, 'package.json');
      if (existsSync(file)) {
        manifests.push({ file, dir: `${group}/${entry.name}`, json: readJson(file) });
      }
    }
  }
  return manifests;
}

export function loadCore(root) {
  return CORE_DIRS.map((name) => {
    const dir = `packages/${name}`;
    const file = join(root, dir, 'package.json');
    if (!existsSync(file)) throw new Error(`core package is missing: ${dir}`);
    return { file, dir, json: readJson(file) };
  });
}

/** Dependency order among the core packages (dependencies first). Throws on a cycle. */
export function publishOrder(core) {
  const names = new Set(core.map((p) => p.json.name));
  const done = [];
  const state = new Map();
  const byName = new Map(core.map((p) => [p.json.name, p]));
  const visit = (pkg) => {
    const s = state.get(pkg.json.name);
    if (s === 'done') return;
    if (s === 'visiting') throw new Error(`dependency cycle at ${pkg.json.name}`);
    state.set(pkg.json.name, 'visiting');
    const deps = { ...pkg.json.dependencies, ...pkg.json.peerDependencies };
    for (const dep of Object.keys(deps).filter((d) => names.has(d)).sort()) visit(byName.get(dep));
    state.set(pkg.json.name, 'done');
    done.push(pkg);
  };
  for (const pkg of core) visit(pkg);
  return done;
}

/** Sets the core version and points every internal caret range at it. Mutates. */
export function bumpManifest(json, version, coreNames) {
  if (coreNames.has(json.name)) json.version = version;
  for (const field of DEP_FIELDS) {
    for (const dep of Object.keys(json[field] ?? {})) {
      if (coreNames.has(dep) && String(json[field][dep]).startsWith('^')) {
        json[field][dep] = `^${version}`;
      }
    }
  }
  return json;
}

/** Rewrites SDK_VERSION and SDK_TARGET_KERNEL in the contract source. */
export function updateContract(text, version) {
  const a = /(export const SDK_VERSION = ')[^']*(';)/;
  const b = /(export const SDK_TARGET_KERNEL = ')[^']*(';)/;
  if (!a.test(text) || !b.test(text)) throw new Error('SDK_VERSION or SDK_TARGET_KERNEL not found');
  return text.replace(a, `$1${version}$2`).replace(b, `$1${majorMinor(version)}$2`);
}

/**
 * Core packages must point at exactly `^<version>`. Other workspace packages
 * (services, ui, cli) may also use a workspace-only range such as `*`.
 */
function rangeOk(range, expected, isCore) {
  if (range === `^${expected}`) return true;
  return !isCore && (range === '*' || /^(file|workspace):/.test(range));
}

/**
 * Cross-checks every place a release version lives. Returns a list of
 * problems; an empty list means the tree is consistent.
 */
export function checkVersions(root, { version, tag } = {}) {
  const problems = [];
  const core = loadCore(root);
  const expected = version ?? core[0].json.version;
  if (!isValid(expected)) return [`"${expected}" is not a valid version (x.y.z or x.y.z-pre.N)`];
  if (tag && tag !== `v${expected}`) problems.push(`tag ${tag} does not match version ${expected}`);
  const coreNames = new Set(core.map((p) => p.json.name));

  for (const pkg of core) {
    const j = pkg.json;
    const at = (msg) => problems.push(`${j.name}: ${msg}`);
    if (!j.name.startsWith('@brud/')) at('name is not in the @brud scope');
    if (j.version !== expected) at(`version is ${j.version}, expected ${expected}`);
    if (j.private) at('is marked private');
    if (j.publishConfig?.access !== 'public') at('publishConfig.access must be "public"');
    if (!j.license) at('has no license');
    if (!j.repository) at('has no repository');
    if (!j.engines?.node) at('has no engines.node');
    for (const s of INSTALL_SCRIPTS) if (j.scripts?.[s]) at(`has an install-time script (${s})`);
    for (const f of ['README.md', 'LICENSE']) {
      if (!existsSync(join(root, pkg.dir, f))) at(`${f} is missing`);
    }
  }

  for (const m of loadWorkspaceManifests(root)) {
    const isCore = coreNames.has(m.json.name);
    for (const field of DEP_FIELDS) {
      for (const [dep, range] of Object.entries(m.json[field] ?? {})) {
        if (coreNames.has(dep) && !rangeOk(range, expected, isCore)) {
          problems.push(`${m.json.name} ${field}.${dep} is "${range}", expected "^${expected}"`);
        }
      }
    }
  }

  const contractPath = join(root, CONTRACT_FILE);
  if (existsSync(contractPath)) {
    const text = readFileSync(contractPath, 'utf8');
    const v = /export const SDK_VERSION = '([^']*)'/.exec(text)?.[1];
    const k = /export const SDK_TARGET_KERNEL = '([^']*)'/.exec(text)?.[1];
    if (v !== expected) problems.push(`SDK_VERSION is ${v}, expected ${expected}`);
    if (k !== majorMinor(expected)) problems.push(`SDK_TARGET_KERNEL is ${k}, expected ${majorMinor(expected)}`);
  } else {
    problems.push(`${CONTRACT_FILE} is missing`);
  }

  const lockPath = join(root, 'package-lock.json');
  if (existsSync(lockPath)) {
    const lock = readJson(lockPath);
    for (const pkg of core) {
      const entry = lock.packages?.[pkg.dir];
      if (!entry) problems.push(`package-lock.json has no entry for ${pkg.dir}`);
      else if (entry.version !== expected) {
        problems.push(`package-lock.json ${pkg.dir} is ${entry.version}, expected ${expected}`);
      }
    }
    for (const [key, entry] of Object.entries(lock.packages ?? {})) {
      if (!key.startsWith('packages/')) continue;
      const isCore = core.some((p) => p.dir === key);
      for (const field of DEP_FIELDS) {
        for (const [dep, range] of Object.entries(entry[field] ?? {})) {
          if (coreNames.has(dep) && !rangeOk(range, expected, isCore)) {
            problems.push(`package-lock.json ${key} ${field}.${dep} is "${range}", expected "^${expected}"`);
          }
        }
      }
    }
  } else {
    problems.push('package-lock.json is missing');
  }
  return problems;
}
