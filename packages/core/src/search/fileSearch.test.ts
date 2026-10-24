import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as pathModule from 'path';
import { NodeFileSystem } from '../testing/nodeFileSystem.js';
import { searchFiles } from './fileSearch.js';
import { matchGlob, isGlobPattern } from './globMatcher.js';
import type { FileSystem } from '../types/filesystem.js';

describe('globMatcher', () => {
  it('matches * as any characters except slash', () => {
    assert.ok(matchGlob('*.ts', 'file.ts'));
    assert.ok(matchGlob('*.ts', 'index.ts'));
    assert.ok(!matchGlob('*.ts', 'path/file.ts'));
  });

  it('matches ** as any characters including slash', () => {
    assert.ok(matchGlob('**/*.ts', 'src/index.ts'));
    assert.ok(matchGlob('**/*.ts', 'file.ts'));
    assert.ok(matchGlob('src/**/*.ts', 'src/utils/helper.ts'));
  });

  it('matches ? as single character', () => {
    assert.ok(matchGlob('file.?s', 'file.ts'));
    assert.ok(matchGlob('file.?s', 'file.js'));
    assert.ok(!matchGlob('file.?s', 'file.tsx'));
  });

  it('matches character classes', () => {
    assert.ok(matchGlob('file.[jt]s', 'file.ts'));
    assert.ok(matchGlob('file.[jt]s', 'file.js'));
    assert.ok(!matchGlob('file.[jt]s', 'file.rs'));
  });

  it('matches character ranges', () => {
    assert.ok(matchGlob('file.[a-z]s', 'file.ts'));
    assert.ok(matchGlob('file.[a-z]s', 'file.js'));
    assert.ok(!matchGlob('file.[a-z]s', 'file.1s'));
  });

  it('detects glob patterns', () => {
    assert.ok(isGlobPattern('*.ts'));
    assert.ok(isGlobPattern('src/**/*.ts'));
    assert.ok(isGlobPattern('file.?s'));
    assert.ok(isGlobPattern('file.[jt]s'));
    assert.ok(!isGlobPattern('index'));
    assert.ok(!isGlobPattern('helper'));
  });
});

async function createTestFiles(baseDir: string, nodeFs: NodeFileSystem): Promise<void> {
  await nodeFs.createDirectory(pathModule.join(baseDir, 'src', 'components'));
  await nodeFs.createDirectory(pathModule.join(baseDir, 'src', 'utils'));
  await nodeFs.createDirectory(pathModule.join(baseDir, 'src', 'node_modules', 'dep'));
  await nodeFs.createDirectory(pathModule.join(baseDir, 'src', '.hidden'));
  await nodeFs.createDirectory(pathModule.join(baseDir, 'docs'));

  await nodeFs.writeFile(pathModule.join(baseDir, 'src', 'index.ts'), 'export const foo = 1;');
  await nodeFs.writeFile(pathModule.join(baseDir, 'src', 'app.ts'), 'export const app = "app";');
  await nodeFs.writeFile(pathModule.join(baseDir, 'src', 'components', 'Button.tsx'), 'export const Button = () => null;');
  await nodeFs.writeFile(pathModule.join(baseDir, 'src', 'components', 'Input.tsx'), 'export const Input = () => null;');
  await nodeFs.writeFile(pathModule.join(baseDir, 'src', 'components', 'styles.css'), '.btn { color: red; }');
  await nodeFs.writeFile(pathModule.join(baseDir, 'src', 'utils', 'helper.ts'), 'export function helper() {}');
  await nodeFs.writeFile(pathModule.join(baseDir, 'src', 'utils', 'constants.ts'), 'export const PI = 3.14;');
  await nodeFs.writeFile(pathModule.join(baseDir, 'src', '.hidden', 'secret.ts'), '// secret');
  await nodeFs.writeFile(pathModule.join(baseDir, 'src', 'node_modules', 'dep', 'lib.ts'), '// lib');
  await nodeFs.writeFile(pathModule.join(baseDir, 'docs', 'readme.md'), '# Readme');
  await nodeFs.writeFile(pathModule.join(baseDir, 'docs', 'api.md'), '# API');
}

describe('fileSearch', () => {
  let tempDir: string;
  let nodeFs: NodeFileSystem;

  before(async () => {
    tempDir = await fs.mkdtemp('/tmp/brud-search-test-');
    nodeFs = new NodeFileSystem();
    await createTestFiles(tempDir, nodeFs);
  });

  after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('search by simple word matches partial file names', async () => {
    const response = await searchFiles(nodeFs, {
      patterns: ['index'],
      directory: tempDir,
      recursive: true,
    });
    assert.ok(response.results.length >= 1);
    assert.ok(response.results.some(r => r.name === 'index'));
  });

  it('search by extension filter', async () => {
    const response = await searchFiles(nodeFs, {
      patterns: ['**/*'],
      extensions: ['.tsx'],
      directory: tempDir,
      recursive: true,
    });
    assert.strictEqual(response.results.length, 2);
    assert.ok(response.results.every(r => r.extension === '.tsx'));
  });

  it('search by glob pattern', async () => {
    const response = await searchFiles(nodeFs, {
      patterns: ['**/*.ts'],
      directory: tempDir,
      recursive: true,
    });
    assert.ok(response.results.some(r => r.path === pathModule.join('src', 'index.ts')));
    assert.ok(response.results.some(r => r.path === pathModule.join('src', 'utils', 'helper.ts')));
  });

  it('exclude patterns work', async () => {
    const response = await searchFiles(nodeFs, {
      patterns: ['**/*'],
      excludePatterns: ['Button'],
      directory: tempDir,
      recursive: true,
    });
    assert.ok(!response.results.some(r => r.name === 'Button'));
  });

  it('max results limit enforced', async () => {
    const response = await searchFiles(nodeFs, {
      patterns: ['**/*'],
      directory: tempDir,
      recursive: true,
      maxResults: 2,
    });
    assert.ok(response.results.length <= 2);
    if (response.totalMatches > 2) {
      assert.ok(response.truncated);
    }
  });

  it('directory scope works', async () => {
    const response = await searchFiles(nodeFs, {
      patterns: ['**/*'],
      directory: pathModule.join(tempDir, 'src'),
      recursive: true,
    });
    assert.ok(response.results.every(r => !r.path.startsWith('..')));
  });

  it('recursive search finds nested files', async () => {
    const response = await searchFiles(nodeFs, {
      patterns: ['**/*'],
      directory: tempDir,
      recursive: true,
    });
    assert.ok(response.results.some(r => r.path.includes('utils')));
  });

  it('non-recursive only finds top-level files', async () => {
    const response = await searchFiles(nodeFs, {
      patterns: ['*'],
      directory: tempDir,
      recursive: false,
    });
    assert.ok(!response.results.some(r => r.path.includes(pathModule.sep)));
  });

  it('skips hidden directories', async () => {
    const response = await searchFiles(nodeFs, {
      patterns: ['**/*'],
      directory: tempDir,
      recursive: true,
    });
    assert.ok(!response.results.some(r => r.path.includes('.hidden')));
  });

  it('skips node_modules directory', async () => {
    const response = await searchFiles(nodeFs, {
      patterns: ['**/*'],
      directory: tempDir,
      recursive: true,
    });
    assert.ok(!response.results.some(r => r.path.includes('node_modules')));
  });

  it('throws error for empty patterns', async () => {
    await assert.rejects(
      () => searchFiles(nodeFs, { patterns: [], directory: tempDir, recursive: true }),
      { code: 'MISSING_FIELD', friendly: 'Missing required field: patterns' },
    );
  });

  it('returns result with correct fields', async () => {
    const response = await searchFiles(nodeFs, {
      patterns: ['index.ts'],
      directory: tempDir,
      recursive: true,
    });
    assert.ok(response.results.length >= 1);
    const result = response.results[0];
    assert.ok(typeof result.path === 'string');
    assert.ok(typeof result.name === 'string');
    assert.ok(typeof result.extension === 'string');
    assert.ok(typeof result.directory === 'string');
    assert.ok(typeof result.size === 'number');
  });
});
function createInstrumentedPort(
  inner: NodeFileSystem,
  counters: { stat: number; body: number },
  options: { withStat: boolean },
): FileSystem {
  const overrides: Partial<FileSystem> = {
    readFile: async (target: string) => {
      counters.body++;
      return inner.readFile(target);
    },
    readFileBytes: async (target: string) => {
      counters.body++;
      return new Uint8Array(await fs.readFile(target));
    },
    stat: async (target: string) => {
      counters.stat++;
      const meta = await fs.stat(target);
      return { size: meta.size, isDirectory: meta.isDirectory() };
    },
  };

  return new Proxy(inner, {
    get(target, property, receiver) {
      if (property === 'stat' && !options.withStat) {
        return undefined;
      }
      if (property in overrides) {
        return overrides[property as keyof FileSystem];
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as FileSystem;
}

describe('fileSearch read-once sizing', () => {
  let tempDir: string;
  let nodeFs: NodeFileSystem;

  before(async () => {
    tempDir = await fs.mkdtemp('/tmp/brud-search-size-');
    nodeFs = new NodeFileSystem();
    await nodeFs.createDirectory(pathModule.join(tempDir, 'src'));
    await nodeFs.writeFile(pathModule.join(tempDir, 'src', 'a.ts'), 'export const a = 1;');
    await nodeFs.writeFile(pathModule.join(tempDir, 'src', 'b.ts'), 'export const b = 2;\n');
  });

  after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('uses fs.stat and never reads file bodies when stat is available', async () => {
    const counters = { stat: 0, body: 0 };
    const port = createInstrumentedPort(nodeFs, counters, { withStat: true });

    const response = await searchFiles(port, {
      patterns: ['**/*'],
      extensions: ['.ts'],
      directory: tempDir,
      recursive: true,
    });

    assert.strictEqual(counters.body, 0);
    assert.ok(counters.stat >= 2);

    const a = response.results.find((entry) => entry.path.endsWith('a.ts'));
    const b = response.results.find((entry) => entry.path.endsWith('b.ts'));
    assert.ok(a);
    assert.ok(b);
    assert.strictEqual(a!.size, Buffer.byteLength('export const a = 1;', 'utf8'));
    assert.strictEqual(b!.size, Buffer.byteLength('export const b = 2;\n', 'utf8'));
  });

  it('falls back to a body read when the port has no stat', async () => {
    const counters = { stat: 0, body: 0 };
    const port = createInstrumentedPort(nodeFs, counters, { withStat: false });

    const response = await searchFiles(port, {
      patterns: ['**/*'],
      extensions: ['.ts'],
      directory: tempDir,
      recursive: true,
    });

    assert.strictEqual(counters.stat, 0);
    assert.ok(counters.body >= 2);

    const a = response.results.find((entry) => entry.path.endsWith('a.ts'));
    assert.ok(a);
    assert.strictEqual(a!.size, Buffer.byteLength('export const a = 1;', 'utf8'));
  });
});
