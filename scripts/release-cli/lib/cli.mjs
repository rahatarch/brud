// Everything the CLI release scripts know about the @brud/cli package and its release notes.
// This pipeline is standalone: it shares no code with scripts/release (the BrudOS pipeline).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isValid } from './semver.mjs';

export const CLI_DIR = 'packages/cli';
export const CLI_NAME = '@brud/cli';
export const TAG_PREFIX = 'cli-v';
export const tagFor = (version) => `${TAG_PREFIX}${version}`;
export const CORE_PEERS = ['@brud/kernel', '@brud/sdk', '@brud/daemon'];
const DEP_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall'];

export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
export const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

export function loadCli(root) {
  const file = join(root, CLI_DIR, 'package.json');
  if (!existsSync(file)) throw new Error(`the CLI package is missing: ${CLI_DIR}`);
  return { file, dir: CLI_DIR, json: readJson(file) };
}

/**
 * Cross-checks every place the CLI version lives and the fields npm needs.
 * Returns a list of problems; an empty list means the tree is ready.
 */
export function checkCli(root, { version, tag } = {}) {
  const problems = [];
  const cli = loadCli(root);
  const j = cli.json;
  const expected = version ?? j.version;
  const at = (msg) => problems.push(`${CLI_NAME}: ${msg}`);
  if (!isValid(expected)) return [`"${expected}" is not a valid version (x.y.z or x.y.z-pre.N)`];
  if (tag && tag !== tagFor(expected)) problems.push(`tag ${tag} does not match version ${expected} (expected ${tagFor(expected)})`);
  if (j.name !== CLI_NAME) at(`name is ${j.name}`);
  if (j.version !== expected) at(`version is ${j.version}, expected ${expected}`);
  if (j.private) at('is marked private');
  if (j.publishConfig?.access !== 'public') at('publishConfig.access must be "public"');
  if (!j.license) at('has no license');
  if (!j.repository) at('has no repository');
  if (!j.engines?.node) at('has no engines.node');
  if (j.bin?.brud !== 'dist/cli.js') at('bin.brud must be "dist/cli.js"');
  for (const s of INSTALL_SCRIPTS) if (j.scripts?.[s]) at(`has an install-time script (${s})`);
  for (const f of ['README.md', 'LICENSE']) if (!existsSync(join(root, cli.dir, f))) at(`${f} is missing`);
  for (const field of DEP_FIELDS) {
    for (const [dep, range] of Object.entries(j[field] ?? {})) {
      if (/^(file|workspace|link):/.test(String(range))) at(`${field}.${dep} is "${range}", which cannot be published`);
    }
  }
  const lockPath = join(root, 'package-lock.json');
  if (existsSync(lockPath)) {
    const entry = readJson(lockPath).packages?.[cli.dir];
    if (!entry) problems.push(`package-lock.json has no entry for ${cli.dir}`);
    else if (entry.version !== expected) problems.push(`package-lock.json ${cli.dir} is ${entry.version}, expected ${expected}`);
  } else problems.push('package-lock.json is missing');
  return problems;
}

// ---- release notes: docs/release-notes/cli-v<version>.md ------------------------------------

export const notesPath = (root, version) => join(root, 'docs', 'release-notes', `${tagFor(version)}.md`);
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

/** Validates the human-written notes. `first` is true for the CLI's first release (Changes optional). */
export function checkNotes(text, version, { first = false } = {}) {
  const problems = [];
  const lines = text.split('\n');
  if (lines[0].trim() !== `# Brud CLI ${version}`) problems.push(`the first line must be "# Brud CLI ${version}"`);
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
  for (const name of GENERATED) if (found.includes(name)) problems.push(`remove "## ${name}": the pipeline generates it`);
  for (const re of PLACEHOLDERS) { const m = re.exec(text); if (m) problems.push(`leftover placeholder: ${m[0]}`); }
  for (const [re, why] of LEAKS) if (re.test(text)) problems.push(`the notes ${why}`);
  if (text.length > MAX_BODY) problems.push('the notes are too long for a GitHub release');
  return problems;
}

export function readNotes(root, version) {
  const file = notesPath(root, version);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

/** Human notes plus the generated Packages and Verification sections. */
export function buildBody({ notes, pkg, nodeRange, commit, tag, runUrl, repo, previousTag }) {
  const compare = previousTag ? `https://github.com/${repo}/compare/${previousTag}...${tag}` : `https://github.com/${repo}/commits/${tag}`;
  const parts = [
    notes.trimEnd(), '',
    '## Packages', '',
    '| Package | Version | Integrity (sha512) |', '|:--|:--|:--|',
    `| \`${pkg.name}\` | ${pkg.version} | \`${pkg.integrity.slice(0, 24)}...\` |`, '',
    `Install: \`npm install -g ${pkg.name}\`, then run \`brud --help\`.${nodeRange ? ` Requires Node.js ${nodeRange}.` : ''}`, '',
    '## Verification', '',
    `- Release commit \`${commit}\`, tag \`${tag}\`.`,
    runUrl
      ? `- Built, tested on Linux, macOS and Windows (global install and project install), and published by [this workflow run](${runUrl}).`
      : '- Built, tested on Linux, macOS and Windows (global install and project install), and published by the CLI release workflow.',
    '- The attached tarball is the exact file published to npm. Check it with `sha256sum -c SHA256SUMS`.',
    `- Build provenance: \`gh attestation verify <tarball> --repo ${repo}\`. The npm package page also shows its provenance, and \`npm audit signatures\` checks it after install.`,
    '', `**Full Changelog:** ${compare}`, '',
  ];
  return parts.join('\n').replace(/\n{3,}/g, '\n\n');
}
