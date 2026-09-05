import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as pathModule from 'path';
import { NodeFileSystem } from '../testing/nodeFileSystem.js';
import { resolveImports, readFileWithImports } from './index.js';
import { getPatternsForFile, languagePatternsRegistry } from './languagePatterns.js';

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

describe('languagePatterns', () => {
  it('returns typescript patterns for .ts files', () => {
    const patterns = getPatternsForFile('/path/to/file.ts');
    assert.strictEqual(patterns.language, 'typescript');
  });

  it('returns typescript patterns for .tsx files', () => {
    const patterns = getPatternsForFile('/path/to/file.tsx');
    assert.strictEqual(patterns.language, 'typescript');
  });

  it('returns typescript patterns for .js files', () => {
    const patterns = getPatternsForFile('/path/to/file.js');
    assert.strictEqual(patterns.language, 'typescript');
  });

  it('defaults to typescript for unknown extensions', () => {
    const patterns = getPatternsForFile('/path/to/file.unknown');
    assert.strictEqual(patterns.language, 'typescript');
  });

  it('has placeholder entries for python, go, rust', () => {
    const languages = languagePatternsRegistry.map(p => p.language);
    assert.ok(languages.includes('python'));
    assert.ok(languages.includes('go'));
    assert.ok(languages.includes('rust'));
  });
});

describe('resolveImports', () => {
  let tempDir: string;

  before(async () => {
    tempDir = await fs.mkdtemp('/tmp/brud-import-test-');
  });

  after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('follows import type statements', async () => {
    const typeFile = pathModule.join(tempDir, 'types.ts');
    await fs.writeFile(typeFile, 'export type Foo = string;');

    const content = `import type { Foo } from './types';\n`;
    const result = await resolveImports(content, pathModule.join(tempDir, 'index.ts'), fileExists);
    assert.ok(result.includes(typeFile), `Expected ${typeFile} in resolved imports: ${result}`);
  });

  it('follows import type default statements', async () => {
    const typeFile = pathModule.join(tempDir, 'default-type.ts');
    await fs.writeFile(typeFile, 'type Bar = number;\nexport default Bar;');

    const content = `import type Bar from './default-type';\n`;
    const result = await resolveImports(content, pathModule.join(tempDir, 'index.ts'), fileExists);
    assert.ok(result.includes(typeFile), `Expected ${typeFile} in resolved imports: ${result}`);
  });

  it('follows inline type imports', async () => {
    const typeFile = pathModule.join(tempDir, 'inline-types.ts');
    await fs.writeFile(typeFile, 'export type MyType = string;');

    const content = `import { type MyType, somethingElse } from './inline-types';\n`;
    const result = await resolveImports(content, pathModule.join(tempDir, 'index.ts'), fileExists);
    assert.ok(result.includes(typeFile), `Expected ${typeFile} in resolved imports: ${result}`);
  });

  it('follows re-exports', async () => {
    const reexportFile = pathModule.join(tempDir, 'reexport-source.ts');
    await fs.writeFile(reexportFile, 'export const foo = 1;');

    const content = `export { foo } from './reexport-source';\n`;
    const result = await resolveImports(content, pathModule.join(tempDir, 'index.ts'), fileExists);
    assert.ok(result.includes(reexportFile), `Expected ${reexportFile} in resolved imports: ${result}`);
  });

  it('follows export * re-exports', async () => {
    const starFile = pathModule.join(tempDir, 'star-reexport.ts');
    await fs.writeFile(starFile, 'export const bar = 2;');

    const content = `export * from './star-reexport';\n`;
    const result = await resolveImports(content, pathModule.join(tempDir, 'index.ts'), fileExists);
    assert.ok(result.includes(starFile), `Expected ${starFile} in resolved imports: ${result}`);
  });

  it('skips non-existent imports', async () => {
    const content = `import { something } from './nonexistent-module';\n`;
    const result = await resolveImports(content, pathModule.join(tempDir, 'index.ts'), fileExists);
    assert.strictEqual(result.length, 0);
  });

  it('skips external package imports', async () => {
    const content = `import { useState } from 'react';\nimport { something } from './local';\n`;
    const result = await resolveImports(content, pathModule.join(tempDir, 'index.ts'), fileExists);
    assert.ok(!result.some(p => p.includes('react')));
  });

  it('resolves regular imports', async () => {
    const sourceFile = pathModule.join(tempDir, 'helper.ts');
    await fs.writeFile(sourceFile, 'export const helper = true;');

    const content = `import { helper } from './helper';\n`;
    const result = await resolveImports(content, pathModule.join(tempDir, 'index.ts'), fileExists);
    assert.ok(result.includes(sourceFile), `Expected ${sourceFile} in resolved imports: ${result}`);
  });

  it('resolves require() calls', async () => {
    const requiredFile = pathModule.join(tempDir, 'required-module.ts');
    await fs.writeFile(requiredFile, 'module.exports = { x: 1 };');

    const content = `const mod = require('./required-module');\n`;
    const result = await resolveImports(content, pathModule.join(tempDir, 'index.ts'), fileExists);
    assert.ok(result.includes(requiredFile), `Expected ${requiredFile} in resolved imports: ${result}`);
  });

  it('resolves dynamic imports', async () => {
    const dynamicFile = pathModule.join(tempDir, 'lazy-module.ts');
    await fs.writeFile(dynamicFile, 'export const lazy = true;');

    const content = `const mod = await import('./lazy-module');\n`;
    const result = await resolveImports(content, pathModule.join(tempDir, 'index.ts'), fileExists);
    assert.ok(result.includes(dynamicFile), `Expected ${dynamicFile} in resolved imports: ${result}`);
  });

  it('resolves index files for directory imports', async () => {
    const dir = pathModule.join(tempDir, 'mydir');
    await fs.mkdir(dir, { recursive: true });
    const indexFile = pathModule.join(dir, 'index.ts');
    await fs.writeFile(indexFile, 'export const x = 1;');

    const content = `import { x } from './mydir';\n`;
    const result = await resolveImports(content, pathModule.join(tempDir, 'index.ts'), fileExists);
    assert.ok(result.includes(indexFile), `Expected ${indexFile} in resolved imports: ${result}`);
  });
});

describe('resolveImports with custom patterns', () => {
  let tempDir: string;

  before(async () => {
    tempDir = await fs.mkdtemp('/tmp/brud-custom-import-');
  });

  after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('uses custom regex pattern instead of built-in patterns', async () => {
    const depFile = pathModule.join(tempDir, 'helper.custom');
    await fs.writeFile(depFile, 'export const helper = true;');

    const content = `import './helper.custom';\n`;
    const customPattern = "import\\s+['\"]([^'\"]+)['\"]";
    const result = await resolveImports(content, pathModule.join(tempDir, 'index.ts'), fileExists, [customPattern]);
    assert.ok(result.includes(depFile), `Expected ${depFile} in resolved imports: ${result}`);
  });

  it('uses multiple custom patterns', async () => {
    const depFile1 = pathModule.join(tempDir, 'lib1.custom');
    const depFile2 = pathModule.join(tempDir, 'lib2.custom');
    await fs.writeFile(depFile1, 'content1');
    await fs.writeFile(depFile2, 'content2');

    const content = `import './lib1.custom';\ninclude './lib2.custom';\n`;
    const patterns = [
      "import\\s+['\"]([^'\"]+)['\"]",
      "include\\s+['\"]([^'\"]+)['\"]",
    ];
    const result = await resolveImports(content, pathModule.join(tempDir, 'index.ts'), fileExists, patterns);
    assert.ok(result.includes(depFile1), `Expected ${depFile1} in resolved imports: ${result}`);
    assert.ok(result.includes(depFile2), `Expected ${depFile2} in resolved imports: ${result}`);
  });

  it('throws clear error for invalid regex pattern', async () => {
    const content = `import 'test';\n`;
    const invalidPattern = "[invalid";
    await assert.rejects(
      () => resolveImports(content, pathModule.join(tempDir, 'index.ts'), fileExists, [invalidPattern]),
      { message: /Invalid importSyntax pattern/ },
    );
  });

  it('falls back to built-in patterns when no custom patterns provided', async () => {
    const depFile = pathModule.join(tempDir, 'fallback-test.ts');
    await fs.writeFile(depFile, 'export const fallback = true;');

    const content = `import { fallback } from './fallback-test';\n`;
    const result = await resolveImports(content, pathModule.join(tempDir, 'index.ts'), fileExists);
    assert.ok(result.includes(depFile), `Expected ${depFile} in resolved imports: ${result}`);
  });

  it('uses custom patterns with readFileWithImports', async () => {
    const depFile = pathModule.join(tempDir, 'custom-imported.custom');
    const nodeFs = new NodeFileSystem();
    await nodeFs.writeFile(depFile, 'custom content');

    const mainFile = pathModule.join(tempDir, 'main.custom');
    await nodeFs.writeFile(mainFile, `import './custom-imported.custom';\n`);

    const result = await readFileWithImports(
      nodeFs,
      mainFile,
      1,
      undefined,
      ["import\\s+['\"]([^'\"]+)['\"]"],
    );
    assert.ok(result.files.has(depFile), `Expected ${depFile} in result files: ${[...result.files.keys()]}`);
    assert.ok(result.files.has(mainFile));
  });
});

describe('readFileWithImports', () => {
  let tempDir: string;
  let nodeFs: NodeFileSystem;

  before(async () => {
    tempDir = await fs.mkdtemp('/tmp/brud-readimports-test-');
    nodeFs = new NodeFileSystem();
  });

  after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('reads type imports recursively', async () => {
    const typesFile = pathModule.join(tempDir, 'types.ts');
    await nodeFs.writeFile(typesFile, 'export type User = { id: number };\n');

    const mainFile = pathModule.join(tempDir, 'index.ts');
    await nodeFs.writeFile(mainFile, `import type { User } from './types';\n`);

    const result = await readFileWithImports(nodeFs, mainFile, 1);
    assert.ok(result.files.has(typesFile), `Expected ${typesFile} in result files`);
    assert.ok(result.files.has(mainFile), `Expected ${mainFile} in result files`);
  });

  it('follows inline type imports in recursive read', async () => {
    const typesFile = pathModule.join(tempDir, 'types.ts');
    await nodeFs.writeFile(typesFile, 'export type Status = "active" | "inactive";\n');

    const mainFile = pathModule.join(tempDir, 'app.ts');
    await nodeFs.writeFile(mainFile, `import { type Status, doSomething } from './types';\n`);

    const result = await readFileWithImports(nodeFs, mainFile, 1);
    assert.ok(result.files.has(typesFile), `Expected ${typesFile} in result files`);
  });

  it('follows re-exports recursively', async () => {
    const sourceFile = pathModule.join(tempDir, 'source.ts');
    await nodeFs.writeFile(sourceFile, 'export const value = 42;\n');

    const barrelFile = pathModule.join(tempDir, 'barrel.ts');
    await nodeFs.writeFile(barrelFile, `export { value } from './source';\n`);

    const mainFile = pathModule.join(tempDir, 'main.ts');
    await nodeFs.writeFile(mainFile, `export { value } from './barrel';\n`);

    const result = await readFileWithImports(nodeFs, mainFile, 2);
    assert.ok(result.files.has(barrelFile));
    assert.ok(result.files.has(sourceFile));
  });
});