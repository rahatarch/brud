import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const sha256Hex = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** npm's `dist.integrity` format: `sha512-<base64>`. */
export const sriSha512 = (file) =>
  `sha512-${createHash('sha512').update(readFileSync(file)).digest('base64')}`;

/** Writes `sha256sum -c` compatible lines: `<hex>  <file>` (two spaces). */
export function writeSums(dir, files, name = 'SHA256SUMS') {
  const lines = files.map((f) => `${sha256Hex(join(dir, f))}  ${f}`);
  writeFileSync(join(dir, name), `${lines.join('\n')}\n`);
  return lines;
}

export function parseSums(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const m = /^([0-9a-f]{64})  (\S.*)$/.exec(line);
    if (!m) throw new Error(`malformed SHA256SUMS line: ${line}`);
    entries.push({ sha256: m[1], file: m[2] });
  }
  return entries;
}

/** Re-hashes every listed file. Returns a list of problems (empty = all match). */
export function verifySums(dir, name = 'SHA256SUMS') {
  const problems = [];
  const sumsFile = join(dir, name);
  if (!existsSync(sumsFile)) return [`${name} is missing in ${dir}`];
  let entries;
  try {
    entries = parseSums(readFileSync(sumsFile, 'utf8'));
  } catch (e) {
    return [e.message];
  }
  if (entries.length === 0) problems.push(`${name} lists no files`);
  for (const { sha256, file } of entries) {
    const path = join(dir, file);
    if (!existsSync(path)) problems.push(`${file} is listed but missing`);
    else if (sha256Hex(path) !== sha256) problems.push(`${file} does not match its checksum`);
  }
  return problems;
}
