import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const notesPath = (root, version) => join(root, 'docs', 'release-notes', `v${version}.md`);

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

/** Section headings (level 2) present in the notes. */
export const headings = (text) =>
  [...text.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1].trim());

/**
 * Validates the human-written notes. `first` is true for a project's first
 * release, where Changes may be left out.
 */
export function checkNotes(text, version, { first = false } = {}) {
  const problems = [];
  const lines = text.split('\n');
  if (lines[0].trim() !== `# BrudOS ${version}`) {
    problems.push(`the first line must be "# BrudOS ${version}"`);
  }
  const found = headings(text);
  const section = (name) => {
    const i = lines.findIndex((l) => new RegExp(`^##\\s+${name}\\s*$`).test(l));
    if (i < 0) return null;
    const rest = lines.slice(i + 1);
    const end = rest.findIndex((l) => /^##\s/.test(l));
    return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
  };
  const summary = section('Summary');
  if (summary === null) problems.push('missing "## Summary"');
  else if (summary.length < 20) problems.push('"## Summary" is too short to be useful');
  const hasChanges = found.includes('Changes') || found.includes('Breaking changes');
  if (!first && !hasChanges) problems.push('add "## Changes" (or "## Breaking changes")');
  for (const name of GENERATED) {
    if (found.includes(name)) problems.push(`remove "## ${name}": the pipeline generates it`);
  }
  for (const re of PLACEHOLDERS) {
    const m = re.exec(text);
    if (m) problems.push(`leftover placeholder: ${m[0]}`);
  }
  for (const [re, why] of LEAKS) if (re.test(text)) problems.push(`the notes ${why}`);
  if (text.length > MAX_BODY) problems.push('the notes are too long for a GitHub release');
  return problems;
}

export function readNotes(root, version) {
  const file = notesPath(root, version);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

/** Human notes plus the generated Packages and Verification sections. */
export function buildBody({ notes, packages, nodeRange, commit, tag, runUrl, repo, previousTag }) {
  const rows = packages
    .map((p) => `| \`${p.name}\` | ${p.version} | \`${p.integrity.slice(0, 24)}...\` |`)
    .join('\n');
  const compare = previousTag
    ? `https://github.com/${repo}/compare/${previousTag}...${tag}`
    : `https://github.com/${repo}/commits/${tag}`;
  const parts = [
    notes.trimEnd(),
    '',
    '## Packages',
    '',
    '| Package | Version | Integrity (sha512) |',
    '|:--|:--|:--|',
    rows,
    '',
    nodeRange ? `Requires Node.js ${nodeRange}.` : '',
    '',
    '## Verification',
    '',
    `- Release commit \`${commit}\`, tag \`${tag}\`.`,
    runUrl
      ? `- Built, tested on Linux, macOS and Windows, and published by [this workflow run](${runUrl}).`
      : '- Built, tested on Linux, macOS and Windows, and published by the release workflow.',
    '- The attached tarballs are the exact files published to npm. Check them with `sha256sum -c SHA256SUMS`.',
    `- Build provenance: \`gh attestation verify <tarball> --repo ${repo}\`. Each npm package page also shows its provenance, and \`npm audit signatures\` checks it after install.`,
    '',
    `**Full Changelog:** ${compare}`,
    '',
  ];
  return parts.join('\n').replace(/\n{3,}/g, '\n\n');
}
