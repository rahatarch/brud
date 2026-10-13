import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as pathModule from 'node:path';
import * as os from 'node:os';
import { promises as fsp } from 'node:fs';

import {
  parseOperationsWithMetadata,
  cleanBrudInput,
  bootCoreKernel,
  DEFAULT_SETTINGS,
  isGlobPattern,
  matchGlob,
} from '@brud/core';
import { parseLegacyFormat } from '../packages/core/src/parser/legacy.js';
import type { FileSystem, FileOperation } from '@brud/core';

const log = (s: string) => console.log(s);

class NodeFs implements FileSystem {
  async readFile(p: string) { return fsp.readFile(p, 'utf8'); }
  async writeFile(p: string, c: string) { await fsp.writeFile(p, c, 'utf8'); }
  async deleteFile(p: string) { await fsp.unlink(p); }
  async renameFile(from: string, to: string) { await fsp.rename(from, to); }
  async copyFile(from: string, to: string) { await fsp.copyFile(from, to); }
  async exists(p: string) { try { await fsp.stat(p); return true; } catch { return false; } }
  async createDirectory(p: string) { await fsp.mkdir(p, { recursive: true }); }
  async deleteDirectoryRecursive(p: string) { await fsp.rm(p, { recursive: true, force: true }); }
  async moveDirectory(from: string, to: string) { await fsp.rename(from, to); }
  async listDirectory(p: string) { return (await fsp.readdir(p)); }
  async listDirectoryContents(p: string) {
    const entries = await fsp.readdir(p, { withFileTypes: true });
    return entries.map(e => ({ name: e.name, isDirectory: e.isDirectory() }));
  }
}

const STRUCTURED_KEYS = new Set(['codebase_metadata', 'extractionResults', 'readResults', 'search_results']);

function tryMergeMessage(message: string, combinedPayload: Record<string, unknown>): void {
  if (!message) return;
  try {
    const parsed = JSON.parse(message);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const key of STRUCTURED_KEYS) {
        if (key in parsed && parsed[key] !== undefined) {
          if (Array.isArray(parsed[key])) {
            const existing = Array.isArray(combinedPayload[key]) ? (combinedPayload[key] as any[]) : [];
            combinedPayload[key] = [...existing, ...(parsed[key] as any[])];
          } else {
            combinedPayload[key] = parsed[key];
          }
        }
      }
    }
  } catch {
    /* not JSON, skip */
  }
}

function patternToRegexVerbatim(pattern: string): string {
  let i = 0;
  let result = '';
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') { result += '.*'; i += 3; }
      else { result += '.*'; i += 2; }
    } else if (ch === '*') { result += '[^/]*'; i++; }
    else if (ch === '?') { result += '[^/]'; i++; }
    else if (ch === '[') {
      const closeBracket = pattern.indexOf(']', i);
      if (closeBracket === -1) { result += '\\['; i++; }
      else {
        result += '[' + pattern.slice(i + 1, closeBracket) + ']';
        i = closeBracket + 1;
      }
    } else if (ch === '{') {
      const closing = findClosingBrace(pattern, i);
      const alternatives = closing !== -1 ? splitBraces(pattern.slice(i + 1, closing)) : [];
      if (closing !== -1 && alternatives.length > 1) {
        result += '(?:' + alternatives.map(a => patternToRegexVerbatim(a)).join('|') + ')';
        i = closing + 1;
      } else {
        result += '\\{';
        i++;
      }
    } else if (ch === '.' || ch === '+' || ch === '^' || ch === '$' || ch === '}' || ch === '(' || ch === ')' || ch === '|' || ch === '\\') {
      result += '\\' + ch;
      i++;
    } else { result += ch; i++; }
  }
  return result;
}

function findClosingBrace(pattern: string, openIndex: number): number {
  let depth = 0;
  for (let j = openIndex; j < pattern.length; j++) {
    if (pattern[j] === '{') depth++;
    else if (pattern[j] === '}') {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

function splitBraces(inner: string): string[] {
  const alternatives: string[] = [];
  let current = '';
  let depth = 0;
  for (const char of inner) {
    if (char === '{') { depth++; current += char; }
    else if (char === '}') { depth--; current += char; }
    else if (char === ',' && depth === 0) { alternatives.push(current); current = ''; }
    else current += char;
  }
  alternatives.push(current);
  return alternatives;
}

test('Scenario A: sequential READ_FILE blocks — 12-layer signal trajectory', async () => {
  const root = await fsp.mkdtemp(pathModule.join(os.tmpdir(), 'brud-trace-a-'));
  await fsp.mkdir(pathModule.join(root, 'web'), { recursive: true });
  await fsp.writeFile(pathModule.join(root, 'web', 'package.json'), '{\n  "name": "web"\n}\n', 'utf8');
  await fsp.writeFile(pathModule.join(root, 'web', 'tsconfig.json'), '{\n  "compilerOptions": {}\n}\n', 'utf8');

  const patch = [
    '<<<<<<< READ_FILE [1]',
    'File Path: web/package.json',
    '>>>>>>> END READ_FILE [1]',
    '<<<<<<< READ_FILE [2]',
    'File Path: web/tsconfig.json',
    '>>>>>>> END READ_FILE [2]',
  ].join('\n');

  log('\n==============================');
  log('SCENARIO A — SEQUENTIAL READ_FILE BLOCKS');
  log('==============================');
  log(`\n[L3-PARSE] input patch text (${patch.split('\n').length} lines):`);
  log(patch);

  const viaLegacy = parseLegacyFormat(patch, [root]);
  const viaHandlerPath = parseOperationsWithMetadata(cleanBrudInput(patch), [root]);
  log('\n[L3-PARSE] parseLegacyFormat operations[]:');
  for (const op of viaLegacy) log(`  ops[${viaLegacy.indexOf(op)}] = ${JSON.stringify({ kind: op.kind, path: (op as any).path, index: op.index, isImportRead: (op as any).isImportRead, maxDepth: (op as any).maxDepth } as any)}`);
  log(`[L3-PARSE] parseOperationsWithMetadata(cleanBrudInput()) .operations.length = ${viaHandlerPath.operations.length}`);
  assert.equal(viaLegacy.length, 2);
  assert.equal(viaHandlerPath.operations.length, 2);
  assert.equal((viaLegacy[0] as any).path, 'web/package.json');
  assert.equal((viaLegacy[1] as any).path, 'web/tsconfig.json');
  const operations = viaLegacy;

  const fs = new NodeFs();
  const kernel = await bootCoreKernel({ fs, settings: DEFAULT_SETTINGS });

  const combinedPayload: Record<string, unknown> = {};
  const operationResults: any[] = [];

  log('\n[L5-L10] adapter harness loop (verbatim of executeOperations.ts:75-150) over kernel.execute():');
  for (let i = 0; i < operations.length; i++) {
    const operation = operations[i];
    const result = await kernel.execute(operation.kind, operation, {
      workspaceRoot: root,
      metadata: { workspaceRoot: root, operationIndex: i },
    });
    const legacyResult = result.data as any;
    const before = JSON.stringify(combinedPayload.readResults ?? null);
    if (legacyResult) {
      tryMergeMessage(legacyResult.message, combinedPayload);
      if (legacyResult.operationResults) {
        for (const opRes of legacyResult.operationResults) {
          tryMergeMessage(opRes.message, combinedPayload);
        }
        operationResults.push(...legacyResult.operationResults);
      }
    }
    const after = JSON.stringify(combinedPayload.readResults ?? null);
    log(`\n  --- iteration i=${i} kind=${operation.kind} path=${(operation as any).path} parsed.index=${operation.index} ---`);
    log(`  kernel.execute -> legacyResult.message            = ${legacyResult?.message ?? '(none)'}`);
    log(`  legacyResult.operationResults[0]= ${JSON.stringify({ kind: legacyResult?.operationResults?.[0]?.kind, status: legacyResult?.operationResults?.[0]?.status, path: legacyResult?.operationResults?.[0]?.path, files: legacyResult?.operationResults?.[0]?.files?.length }) as any}`);
    log(`  combinedPayload.readResults BEFORE tryMergeMessage = ${before}`);
    log(`  combinedPayload.readResults AFTER  tryMergeMessage = ${after}`);
  }

  const finalMessage = Object.keys(combinedPayload).length > 0
    ? JSON.stringify(combinedPayload)
    : 'All operations failed.';

  log('\n[L10-L11] exact serialized result.message produced by the adapter loop:');
  log(finalMessage);

  const parsed = JSON.parse(finalMessage);
  log('\n[L11-HOST] ApplyPatchHandler unpacking of parsedMessage.readResults (for..of):');
  const readResults = parsed.readResults ?? [];
  log(`  parsedMessage.readResults.length = ${readResults.length}`);
  for (const d of readResults) {
    const files = d.files ?? [];
    log(`    readResults entry operationIndex=${d.operationIndex} totalFiles=${d.totalFiles} files=${files.map((f: any) => f.path).join(', ')}`);
  }

  log('\n[L12-WEBVIEW] renderers/readRenderer.tsx ReadFileList would render:');
  if (readResults.length > 0) {
    for (const f of readResults[0].files ?? []) log(`  ReadFileList file entry: ${f.path}`);
  } else {
    log('  (nothing — readResults empty)');
  }

  log('\n>>> DIAGNOSIS:');
  const readPaths = readResults.flatMap((e: any) => (e.files ?? []).map((f: any) => f.path));
  log(`  Files surfacing to webview: ${JSON.stringify(readPaths)}`);
  log(`  READ_FILE [1] web/package.json present? ${readPaths.some((p: string) => p.endsWith('package.json')) ? 'YES' : 'NO — STILL DROPPED'}`);
  log(`  READ_FILE [2] web/tsconfig.json present? ${readPaths.some((p: string) => p.endsWith('tsconfig.json')) ? 'YES' : 'NO — STILL DROPPED'}`);
  log(`  readResults.length = ${readResults.length}  (expected 2 — both sequential READ_FILE results preserved)`);

  assert.equal(readResults.length, 2);
  assert.ok(readPaths.some((p: string) => p.endsWith('tsconfig.json')));
  assert.ok(readPaths.some((p: string) => p.endsWith('package.json')));
  await fsp.rm(root, { recursive: true, force: true });
});

test('Scenario B: READ_FILES multi-file pattern evaluation', async () => {
  const root = await fsp.mkdtemp(pathModule.join(os.tmpdir(), 'brud-trace-b-'));
  const composables = pathModule.join(root, 'app', 'composables');
  await fsp.mkdir(composables, { recursive: true });
  await fsp.writeFile(pathModule.join(composables, 'useSearchMenus.ts'), 'export const useSearchMenus = () => {};\n', 'utf8');
  await fsp.writeFile(pathModule.join(composables, 'useAdminLogin.ts'), 'export const useAdminLogin = () => {};\n', 'utf8');
  await fsp.writeFile(pathModule.join(composables, 'useOther.ts'), 'export const useOther = () => {};\n', 'utf8');

  const syntax1 = [
    '<<<<<<< READ_FILES [1]',
    'Pattern: app/composables/{useSearchMenus,useAdminLogin}.ts',
    '>>>>>>> END READ_FILES [1]',
  ].join('\n');

  const syntax2 = [
    '<<<<<<< READ_FILES [2]',
    'Pattern: app/composables/useSearchMenus.ts, app/composables/useAdminLogin.ts',
    '>>>>>>> END READ_FILES [2]',
  ].join('\n');

  log('\n==================================');
  log('SCENARIO B — READ_FILES PATTERNS');
  log('==================================');

  const op1 = parseLegacyFormat(syntax1, [root])[0] as any;
  const op2 = parseLegacyFormat(syntax2, [root])[0] as any;

  log('\n[STAGE 1 — legacy.ts:1134 splitRespectingBraces() brace-aware splitting]');
  log(`  SYNTAX 1: "app/composables/{useSearchMenus,useAdminLogin}.ts"`);
  log(`    -> patterns[] = ${JSON.stringify(op1.patterns)}`);
  log(`  SYNTAX 2: "app/composables/useSearchMenus.ts, app/composables/useAdminLogin.ts"`);
  log(`    -> patterns[] = ${JSON.stringify(op2.patterns)}`);
  assert.deepEqual(op1.patterns, ['app/composables/{useSearchMenus,useAdminLogin}.ts']);
  assert.deepEqual(op2.patterns, ['app/composables/useSearchMenus.ts', 'app/composables/useAdminLogin.ts']);

  log('\n[STAGE 2 — file-operations/index.ts:1283-1285 recursive prefix expansion]');
  const expand = (patterns: string[]) => patterns.map(p => isGlobPattern(p) && !p.includes('**') ? `**/${p}` : p);
  const expanded1 = expand(op1.patterns);
  const expanded2 = expand(op2.patterns);
  log(`  SYNTAX 1 expanded = ${JSON.stringify(expanded1)}  <-- braces are glob metachars now, so the **/ prefix IS applied`);
  log(`  SYNTAX 2 expanded = ${JSON.stringify(expanded2)}  <-- unchanged: isGlobPattern=false (no metachar), **/ prefix not needed`);
  assert.deepEqual(expanded2, op2.patterns);

  log('\n[STAGE 4 — globMatcher.ts:11-49 patternToRegex()]');
  for (const p of expanded1) log(`  pattern "${p}" -> regex ${JSON.stringify(patternToRegexVerbatim(p))}  <-- '{...}' expands to (?:a|b) non-capturing alternation`);
  for (const p of expanded2) log(`  pattern "${p}" -> regex ${JSON.stringify(patternToRegexVerbatim(p))}`);

  const relPath = pathModule.relative(root, pathModule.join(composables, 'useSearchMenus.ts'));
  log(`\n  candidate relativePath (fileSearch.ts:33) = "${relPath}" (baseDir = workspace root)`);

  log('\n[STAGE 3 — fileSearch.ts:32-48 matchesPatterns() actual evaluation]');
  for (const p of expanded1) {
    const isGlob = isGlobPattern(p);
    const globMatch = isGlob ? matchGlob(p, relPath) : false;
    const basename = pathModule.basename(pathModule.join(composables, 'useSearchMenus.ts'));
    const substrMatch = isGlob ? false : basename.toLowerCase().includes(p.toLowerCase());
    log(`  SYNTAX1 pattern "${p}": isGlob=${isGlob} -> matchGlob(${JSON.stringify(p)}, "${relPath}")=${globMatch} ${!isGlob ? `| basename.substring("${basename}".includes("${p}"))=${substrMatch}` : ''}`);
  }
  for (const p of expanded2) {
    const isGlob = isGlobPattern(p);
    const globMatch = isGlob ? matchGlob(p, relPath) : false;
    const basename = pathModule.basename(pathModule.join(composables, 'useSearchMenus.ts'));
    const substrMatch = isGlob ? false : basename.toLowerCase().includes(p.toLowerCase());
    log(`  SYNTAX2 pattern "${p}": isGlob=${isGlob} -> matchGlob(...)=${globMatch} | basename.substring("${basename}" includes "${p}")=${substrMatch}  <-- slash-path patterns now fall through to relativePath matching`);
  }

  log('\n[EXECUTION — real read_files handler in kernel, message payload]');
  const fs = new NodeFs();
  const kernel = await bootCoreKernel({ fs, settings: DEFAULT_SETTINGS });

  for (const [label, op] of [['SYNTAX 1', op1], ['SYNTAX 2', op2]] as [string, any][]) {
    const result = await kernel.execute('read_files', op, { workspaceRoot: root, metadata: { workspaceRoot: root, operationIndex: 0 } });
    const msg = (result.data as any)?.message;
    let parsed: any = null;
    try { parsed = JSON.parse(msg); } catch { /* noop */ }
    const found = parsed?.readResults?.[0]?.files?.length ?? 0;
    const total = parsed?.readResults?.[0]?.totalFiles ?? 0;
    log(`  ${label}: kernel result.status=${result.status}`);
    log(`  ${label}: readResults[0].totalFiles = ${total}  (expected 2) — files[${found}] ${found === 0 ? '<<-- MATCH FAILED: no files resolved' : ''}`);
    log(`  ${label}: serialized message = ${msg}`);
    assert.equal(total, 2, `${label} failed to resolve both files (totalFiles=${total})`);
    assert.equal(found, 2, `${label} failed to materialize both file entries (files.length=${found})`);
  }

  log('\n>>> DIAGNOSIS (Scenario B):');
  log('  RESOLVED: (a) legacy.ts splitRespectingBraces() no longer splits on commas inside {..};');
  log('  (b) globMatcher.ts patternToRegex() expands {a,b} into (?:a|b) alternation;');
  log('  (c) fileSearch.ts matchesPatterns() now matches slash-containing non-glob patterns');
  log('  against the normalized relativePath.');
  log('  SYNTAX 1 & SYNTAX 2 should both resolve totalFiles === 2.');

  await fsp.rm(root, { recursive: true, force: true });
});