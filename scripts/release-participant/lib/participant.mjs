// Everything the participant release scripts know about a participant package (@brud/<name>) and its release notes.
// Standalone: it shares no code with scripts/release (BrudOS) or scripts/release-cli (the CLI).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isValid } from './semver.mjs';

export const SCOPE = '@brud/';
/** Core and tooling packages share the flat @brud/ namespace; a participant may never take these names. */
export const RESERVED = ['kernel', 'protocol', 'sdk', 'daemon', 'cli', 'ui'];
export const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
export const tagFor = (name, version) => `${name}@${version}`;
const TAG_RE = /^([a-z0-9][a-z0-9-]*)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;
export const parseTag = (tag) => { const m = TAG_RE.exec(tag ?? ''); return m ? { name: m[1], version: m[2] } : null; };
const DEP_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall'];

export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
export const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

/** Every workspace package (root package.json "workspaces", patterns like `dir/*` or an exact dir). */
export function listPackages(root) {
  const out = [];
  for (const pattern of readJson(join(root, 'package.json')).workspaces ?? []) {
    const dirs = pattern.endsWith('/*')
      ? (existsSync(join(root, pattern.slice(0, -2))) ? readdirSync(join(root, pattern.slice(0, -2))).map((d) => `${pattern.slice(0, -2)}/${d}`) : [])
      : [pattern];
    for (const dir of dirs) {
      const file = join(root, dir, 'package.json');
      if (existsSync(file)) out.push({ dir, file, json: readJson(file) });
    }
  }
  return out;
}

export const findParticipant = (root, name) => listPackages(root).find((p) => p.json.name === `${SCOPE}${name}`) ?? null;
export function loadParticipant(root, name) {
  const found = findParticipant(root, name);
  if (!found) throw new Error(`no workspace package is named ${SCOPE}${name}`);
  return found;
}
export const participants = (root) => listPackages(root).filter((p) => p.json.brud?.role === 'participant');

/**
 * Cross-checks the participant's package.json, files and lockfile entry.
 * Returns a list of problems; an empty list means the tree is ready.
 */
export function checkParticipant(root, name, { version, tag } = {}) {
  const problems = [];
  const at = (msg) => problems.push(`${SCOPE}${name}: ${msg}`);
  if (!NAME_RE.test(name)) return [`"${name}" is not a valid participant name (lowercase letters, digits, hyphens)`];
  if (RESERVED.includes(name)) return [`"${name}" is reserved for the core and tooling packages`];
  const found = findParticipant(root, name);
  if (!found) return [`no workspace package is named ${SCOPE}${name}`];
  const j = found.json;
  const expected = version ?? j.version;
  if (!isValid(expected)) return [`"${expected}" is not a valid version (x.y.z or x.y.z-pre.N)`];
  if (tag && tag !== tagFor(name, expected)) problems.push(`tag ${tag} does not match ${tagFor(name, expected)}`);
  if (j.brud?.role !== 'participant') at('package.json needs "brud": { "role": "participant" }');
  if (j.version !== expected) at(`version is ${j.version}, expected ${expected}`);
  if (j.private) at('is marked private');
  if (j.publishConfig?.access !== 'public') at('publishConfig.access must be "public"');
  if (!j.license) at('has no license');
  if (!j.repository) at('has no repository');
  if (!j.engines?.node) at('has no engines.node');
  if (!j.main && !j.exports) at('has no main or exports');
  if (JSON.stringify(j.files ?? []) !== '["dist"]') at('files must be exactly ["dist"]');
  for (const s of INSTALL_SCRIPTS) if (j.scripts?.[s]) at(`has an install-time script (${s})`);
  for (const f of ['README.md', 'LICENSE']) if (!existsSync(join(root, found.dir, f))) at(`${f} is missing`);
  for (const field of DEP_FIELDS) {
    for (const [dep, range] of Object.entries(j[field] ?? {})) {
      if (/^(file|workspace|link):/.test(String(range))) at(`${field}.${dep} is "${range}", which cannot be published`);
      else if (/^(\*|latest|x)?$/.test(String(range))) at(`${field}.${dep} is "${range}"; use a real range (run release:participant:prepare)`);
    }
  }
  if (j.dependencies?.['@brud/kernel'] !== undefined) at('@brud/kernel must be a peerDependency, not a dependency');
  if (j.peerDependencies?.['@brud/kernel'] === undefined) at('@brud/kernel must be declared in peerDependencies');
  const lockPath = join(root, 'package-lock.json');
  if (existsSync(lockPath)) {
    const entry = readJson(lockPath).packages?.[found.dir];
    if (!entry) problems.push(`package-lock.json has no entry for ${found.dir}`);
    else if (entry.version !== expected) problems.push(`package-lock.json ${found.dir} is ${entry.version}, expected ${expected}`);
  } else problems.push('package-lock.json is missing');
  return problems;
}

// ---- release notes: docs/release-notes/<name>@<version>.md -----------------------------------

export const notesPath = (root, name, version) => join(root, 'docs', 'release-notes', `${tagFor(name, version)}.md`);
const PLACEHOLDERS = [
  /<(component|version|sha|pr|change|what changed[^>]*|two to four sentences\.?)>/i,
  /\bTODO\b|\bTBD\b|\bFIXME\b|lorem ipsum/i,
];
const LEAKS = [
  [/\.internal_docs/, 'mentions the internal ledger'],
  [/(^|[\s(`"'])\/(home|media|Users|mnt|sessions|tmp)\//, 'contains a machine-specific path'],
  [/\bnpm_[A-Za-z0-9]{20,}/, 'looks like it contains an npm token'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/, 'looks like it contains a GitHub token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'contains a private key'],
];
const GENERATED = ['Packages', 'Verification'];
export const MAX_BODY = 120_000; // GitHub's release body limit is 125,000 characters
export const headings = (text) => [...text.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1].trim());

/** Validates the human-written notes. `first` is true for the participant's first release (Changes optional). */
export function checkNotes(text, name, version, { first = false } = {}) {
  const problems = [];
  const lines = text.split('\n');
  if (lines[0].trim() !== `# ${name} ${version}`) problems.push(`the first line must be "# ${name} ${version}"`);
  const found = headings(text);
  const i = lines.findIndex((l) => /^##\s+Summary\s*$/.test(l));
  let summary = null;
  if (i >= 0) {
    const rest = lines.slice(i + 1);
    const end = rest.findIndex((l) => /^##\s/.test(l));
    summary = (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
  }
  if (summary === null) problems.push('missing "## Summary"');
  else if (summary.length < 20) problems.push('"## Summary" is too short to be useful');
  if (!first && !found.includes('Changes') && !found.includes('Breaking changes')) problems.push('add "## Changes" (or "## Breaking changes")');
  for (const g of GENERATED) if (found.includes(g)) problems.push(`remove "## ${g}": the pipeline generates it`);
  for (const re of PLACEHOLDERS) { const m = re.exec(text); if (m) problems.push(`leftover placeholder: ${m[0]}`); }
  for (const [re, why] of LEAKS) if (re.test(text)) problems.push(`the notes ${why}`);
  if (text.length > MAX_BODY) problems.push('the notes are too long for a GitHub release');
  return problems;
}

export function readNotes(root, name, version) {
  const file = notesPath(root, name, version);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

/** Human notes plus the generated Packages and Verification sections. */
export function buildBody({ notes, pkg, nodeRange, commit, tag, runUrl, repo, previousTag }) {
  const short = pkg.name.slice(SCOPE.length);
  const compare = previousTag ? `https://github.com/${repo}/compare/${previousTag}...${tag}` : `https://github.com/${repo}/commits/${tag}`;
  return [
    notes.trimEnd(), '',
    '## Packages', '',
    '| Package | Version | Integrity (sha512) |', '|:--|:--|:--|',
    `| \`${pkg.name}\` | ${pkg.version} | \`${pkg.integrity.slice(0, 24)}...\` |`, '',
    `Add it to a project: \`brud add ${short}\`, or \`npm install ${pkg.name}\`.${nodeRange ? ` Requires Node.js ${nodeRange}.` : ''}`, '',
    '## Verification', '',
    `- Release commit \`${commit}\`, tag \`${tag}\`.`,
    runUrl
      ? `- Built, installed and loaded on Linux, macOS and Windows, and published by [this workflow run](${runUrl}).`
      : '- Built, installed and loaded on Linux, macOS and Windows, and published by the participant release workflow.',
    '- The attached tarball is the exact file published to npm. Check it with `sha256sum -c SHA256SUMS`.',
    `- Build provenance: \`gh attestation verify <tarball> --repo ${repo}\`. The npm package page also shows its provenance.`,
    '', `**Full Changelog:** ${compare}`, '',
  ].join('\n').replace(/\n{3,}/g, '\n\n');
}
