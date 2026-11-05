import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile } from '../readEngine.js';
import type { ReadResult } from '../envelope.js';
import { bootReaderKernel, type ReaderHarness } from './reader-test-helpers.js';

function paths(result: ReadResult): string[] {
  return result.files.map((file) => file.path);
}

function importedPaths(result: ReadResult): string[] {
  return result.files.filter((file) => file.isImported === true).map((file) => file.path);
}

async function chain(harness: ReaderHarness, depth: number): Promise<void> {
  for (let index = 0; index < depth; index += 1) {
    const next = index + 1 < depth
      ? `import { value${index + 1} } from './f${index + 1}';`
      : 'export const end = true;';
    await harness.write(`src/f${index}.ts`, `${next}\nexport const value${index} = ${index};\n`);
  }
}

describe('Goal 4 — import following', () => {
  it('follows a TypeScript import with an explicit extension', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { b } from './b.ts';\n");
    await harness.write('src/b.ts', 'export const b = 1;\n');

    const result = await readFile(harness.runtime(), { filePath: 'src/a.ts', isImportRead: true });

    assert.deepEqual(paths(result), ['src/a.ts', 'src/b.ts']);
  });

  it('follows an extensionless TypeScript import', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { b } from './b';\n");
    await harness.write('src/b.ts', 'export const b = 1;\n');

    const result = await readFile(harness.runtime(), { filePath: 'src/a.ts', isImportRead: true });

    assert.deepEqual(paths(result), ['src/a.ts', 'src/b.ts']);
  });

  it('resolves a directory import to its index file', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "export * from './nested';\n");
    await harness.write('src/nested/index.ts', 'export const nested = true;\n');

    const result = await readFile(harness.runtime(), { filePath: 'src/a.ts', isImportRead: true });

    assert.deepEqual(paths(result), ['src/a.ts', 'src/nested/index.ts']);
  });

  it('follows a type-only import', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import type { T } from './types';\n");
    await harness.write('src/types.ts', 'export type T = string;\n');

    const result = await readFile(harness.runtime(), { filePath: 'src/a.ts', isImportRead: true });

    assert.deepEqual(paths(result), ['src/a.ts', 'src/types.ts']);
  });

  it('follows a dynamic import', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "void import('./dynamic');\n");
    await harness.write('src/dynamic.ts', 'export const dynamic = true;\n');

    const result = await readFile(harness.runtime(), { filePath: 'src/a.ts', isImportRead: true });

    assert.deepEqual(paths(result), ['src/a.ts', 'src/dynamic.ts']);
  });

  it('follows a CommonJS require', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "const b = require('./required');\n");
    await harness.write('src/required.ts', 'export const required = true;\n');

    const result = await readFile(harness.runtime(), { filePath: 'src/a.ts', isImportRead: true });

    assert.deepEqual(paths(result), ['src/a.ts', 'src/required.ts']);
  });

  it('follows transitive imports', async (t) => {
    const harness = await bootReaderKernel(t);
    await chain(harness, 3);

    const result = await readFile(harness.runtime(), { filePath: 'src/f0.ts', isImportRead: true });

    assert.deepEqual(paths(result), ['src/f0.ts', 'src/f1.ts', 'src/f2.ts']);
  });

  it('follows every depth when maxDepth is 0', async (t) => {
    const harness = await bootReaderKernel(t);
    await chain(harness, 4);

    const result = await readFile(harness.runtime(), {
      filePath: 'src/f0.ts',
      isImportRead: true,
      maxDepth: 0,
    });

    assert.deepEqual(paths(result), ['src/f0.ts', 'src/f1.ts', 'src/f2.ts', 'src/f3.ts']);
  });

  it('follows only direct imports when maxDepth is 1', async (t) => {
    const harness = await bootReaderKernel(t);
    await chain(harness, 4);

    const result = await readFile(harness.runtime(), {
      filePath: 'src/f0.ts',
      isImportRead: true,
      maxDepth: 1,
    });

    assert.deepEqual(paths(result), ['src/f0.ts', 'src/f1.ts']);
  });

  it('follows two levels when maxDepth is 2', async (t) => {
    const harness = await bootReaderKernel(t);
    await chain(harness, 4);

    const result = await readFile(harness.runtime(), {
      filePath: 'src/f0.ts',
      isImportRead: true,
      maxDepth: 2,
    });

    assert.deepEqual(paths(result), ['src/f0.ts', 'src/f1.ts', 'src/f2.ts']);
  });

  it('treats a negative maxDepth as unlimited', async (t) => {
    const harness = await bootReaderKernel(t);
    await chain(harness, 3);

    const result = await readFile(harness.runtime(), {
      filePath: 'src/f0.ts',
      isImportRead: true,
      maxDepth: -1,
    });

    assert.deepEqual(paths(result), ['src/f0.ts', 'src/f1.ts', 'src/f2.ts']);
  });

  it('breaks an A -> B -> A import cycle without duplicating files', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { b } from './b';\nexport const a = true;\n");
    await harness.write('src/b.ts', "import { a } from './a';\nexport const b = true;\n");

    const result = await readFile(harness.runtime(), { filePath: 'src/a.ts', isImportRead: true });

    assert.deepEqual(paths(result), ['src/a.ts', 'src/b.ts']);
  });

  it('breaks a self-import cycle', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { a } from './a';\nexport const a = true;\n");

    const result = await readFile(harness.runtime(), { filePath: 'src/a.ts', isImportRead: true });

    assert.deepEqual(paths(result), ['src/a.ts']);
  });

  it('records multiple imports in discovery order', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { b } from './b';\nimport { c } from './c';\nimport { d } from './d';\n");
    await harness.write('src/b.ts', 'export const b = true;\n');
    await harness.write('src/c.ts', 'export const c = true;\n');
    await harness.write('src/d.ts', 'export const d = true;\n');

    const result = await readFile(harness.runtime(), { filePath: 'src/a.ts', isImportRead: true });

    assert.deepEqual(importedPaths(result), ['src/b.ts', 'src/c.ts', 'src/d.ts']);
  });

  it('honors a custom import pattern', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', '@load ./b\n');
    await harness.write('src/b.ts', 'export const b = true;\n');

    const result = await readFile(harness.runtime(), {
      filePath: 'src/a.ts',
      isImportRead: true,
      importSyntax: String.raw`@load\s+(\S+)`,
    });

    assert.deepEqual(paths(result), ['src/a.ts', 'src/b.ts']);
  });

  it('replaces the built-in patterns when a custom pattern is supplied', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { builtin } from './builtin';\n@load ./custom\n");
    await harness.write('src/builtin.ts', 'export const builtin = true;\n');
    await harness.write('src/custom.ts', 'export const custom = true;\n');

    const result = await readFile(harness.runtime(), {
      filePath: 'src/a.ts',
      isImportRead: true,
      importSyntax: String.raw`@load\s+(\S+)`,
    });

    assert.deepEqual(importedPaths(result), ['src/custom.ts']);
  });

  it('returns INVALID_FIELD for a malformed custom import pattern', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { b } from './b';\n");
    await harness.write('src/b.ts', 'export const b = true;\n');

    const result = await harness.call('read_file', {
      filePath: 'src/a.ts',
      isImportRead: true,
      importSyntax: '[',
    });

    assert.equal(result.status, 'failed');
    assert.equal((result as { code?: string }).code, 'INVALID_FIELD');
  });

  it('does not follow imports when isImportRead is false', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { b } from './b';\n");
    await harness.write('src/b.ts', 'export const b = true;\n');

    const result = await readFile(harness.runtime(), { filePath: 'src/a.ts', isImportRead: false });

    assert.deepEqual(paths(result), ['src/a.ts']);
  });

  it('skips an excluded import without failing the operation', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { b } from './b';\nimport { c } from './c';\n");
    await harness.write('src/b.ts', 'export const b = true;\n');
    await harness.write('src/c.ts', 'export const c = true;\n');

    const result = await readFile(harness.runtime(), {
      filePath: 'src/a.ts',
      isImportRead: true,
      exclude: 'b.ts',
    });

    assert.deepEqual(paths(result), ['src/a.ts', 'src/c.ts']);
  });

  it('filters a missing import target without failing the operation', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { missing } from './missing';\nexport const a = true;\n");

    const result = await readFile(harness.runtime(), { filePath: 'src/a.ts', isImportRead: true });

    assert.deepEqual(paths(result), ['src/a.ts']);
    assert.deepEqual(result.skips, []);
  });

  it('records an existing-but-unreadable import as a skip', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { b } from './b';\nexport const a = true;\n");
    await harness.mkdir('src/b.ts');

    const result = await readFile(harness.runtime(), { filePath: 'src/a.ts', isImportRead: true });

    assert.deepEqual(paths(result), ['src/a.ts']);
    assert.equal(result.skips?.length, 1);
    assert.equal(result.skips?.[0]?.path, 'src/b.ts');
    assert.equal(result.skips?.[0]?.reason, 'unreadable');
  });

  it('delivers a binary import with isBinary true and a binary skip', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { image } from './image.bin';\n");
    await harness.write('src/image.bin', Buffer.from([0x00, 0x01, 0x02]));

    const result = await readFile(harness.runtime(), { filePath: 'src/a.ts', isImportRead: true });
    const imported = result.files.find((file) => file.path === 'src/image.bin');

    assert.equal(imported?.isBinary, true);
    assert.equal(imported?.content, undefined);
    assert.equal(imported?.isImported, true);
    assert.ok(result.skips?.some((skip) => skip.path === 'src/image.bin' && skip.reason === 'binary'));
  });

  it('marks every import with isImported and the root provenance', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { b } from './b';\n");
    await harness.write('src/b.ts', 'export const b = true;\n');

    const result = await readFile(harness.runtime(), { filePath: 'src/a.ts', isImportRead: true });

    assert.equal(result.files[0]?.isImported, undefined);
    assert.equal(result.files[1]?.isImported, true);
    assert.equal(result.files[1]?.importedFrom, 'src/a.ts');
  });

  it('applies line slicing to the root only', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { b } from './b';\nsecond root line\n");
    await harness.write('src/b.ts', 'imported line one\nimported line two\n');

    const result = await readFile(harness.runtime(), {
      filePath: 'src/a.ts',
      isImportRead: true,
      startLine: 1,
      endLine: 1,
    });

    assert.equal(result.files[0]?.content, "import { b } from './b';\n");
    assert.equal(result.files[0]?.totalLines, 2);
    assert.equal(result.files[1]?.content, 'imported line one\nimported line two\n');
    assert.equal(result.files[1]?.startLine, 1);
    assert.equal(result.files[1]?.endLine, 2);
  });

  it('follows a Python import with an explicit .py specifier', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.py', 'from ./b.py import value\n');
    await harness.write('src/b.py', 'value = 1\n');

    const result = await readFile(harness.runtime(), { filePath: 'src/a.py', isImportRead: true });

    assert.deepEqual(paths(result), ['src/a.py', 'src/b.py']);
  });

  it('follows a Python import statement with an explicit .py specifier', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.py', 'import ./b.py\n');
    await harness.write('src/b.py', 'value = 1\n');

    const result = await readFile(harness.runtime(), { filePath: 'src/a.py', isImportRead: true });

    assert.deepEqual(paths(result), ['src/a.py', 'src/b.py']);
  });

  it('does not resolve extensionless Python modules (documented UtilityService limitation)', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.py', 'from .b import value\n');
    await harness.write('src/b.py', 'value = 1\n');

    const result = await readFile(harness.runtime(), { filePath: 'src/a.py', isImportRead: true });

    assert.deepEqual(paths(result), ['src/a.py']);
  });

  it('ignores external package imports', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import fs from 'node:fs';\nimport { local } from './local';\n");
    await harness.write('src/local.ts', 'export const local = true;\n');

    const result = await readFile(harness.runtime(), { filePath: 'src/a.ts', isImportRead: true });

    assert.deepEqual(importedPaths(result), ['src/local.ts']);
  });

  it('follows an absolute import path inside the workspace', async (t) => {
    const harness = await bootReaderKernel(t);
    const absolute = join(harness.root, 'src', 'b.ts');
    await harness.write('src/a.ts', `import { b } from '${absolute.replace(/\\/gu, '/')}';\n`);
    await harness.write('src/b.ts', 'export const b = true;\n');

    const result = await readFile(harness.runtime(), { filePath: 'src/a.ts', isImportRead: true });

    assert.deepEqual(paths(result), ['src/a.ts', 'src/b.ts']);
  });

  it('does not follow a side-effect-only import (documented pattern-table limitation)', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import './b';\nexport const a = true;\n");
    await harness.write('src/b.ts', 'export const b = true;\n');

    const result = await readFile(harness.runtime(), { filePath: 'src/a.ts', isImportRead: true });

    assert.deepEqual(paths(result), ['src/a.ts']);
  });

  it('never follows an import outside the workspace', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { p } from '/etc/passwd';\nexport const a = true;\n");

    const result = await readFile(harness.runtime(), { filePath: 'src/a.ts', isImportRead: true });

    assert.deepEqual(paths(result), ['src/a.ts']);
    assert.equal(result.files.some((file) => file.path.includes('passwd')), false);
  });
});