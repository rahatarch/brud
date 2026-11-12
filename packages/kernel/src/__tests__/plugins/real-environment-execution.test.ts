import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createStandardKernel } from '../../bootstrap/index.js';
import type { ServiceContext } from '../../contracts/lifecycle.js';
import { BrudToolsToken } from '../../../../services/BrudTools/descriptor/tokens.js';
import { DurableNodeStorageDriver } from '../../../../services/BrudFileSystem/drivers/DurableNodeStorageDriver.js';
import type { IBrudPlugin } from '../../../../services/PluginManager/contracts/IBrudPlugin.js';
import { PluginManagerToken } from '../../../../services/PluginManager/contracts/tokens.js';
import { safeRm } from '../support/cleanup.js';
import { workspaceContextOptions } from '../support/workspaceContext.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGINS_ROOT = resolve(HERE, '../../../../plugins');

const STRUCTURE_ID = 'akkhar-labs.plugin.structure';
const SEARCH_ID = 'akkhar-labs.plugin.search';

interface StructureModule {
  createStructurePlugin(): IBrudPlugin;
}

interface SearchModule {
  createSearchPlugin(): IBrudPlugin;
}

async function loadPluginModule<T>(packageName: string): Promise<T> {
  const entry = pathToFileURL(join(PLUGINS_ROOT, packageName, 'src', 'index.ts')).href;

  return await import(entry) as T;
}

interface FixtureFile {
  readonly path: string;
  readonly content: string;
}

const FIXTURES: readonly FixtureFile[] = [
  { path: 'package.json', content: '{}\n' },
  { path: 'src/index.ts', content: 'export const a = 1;\nexport const b = 2;\n' },
  { path: 'src/util.js', content: 'export function noop() {}\n' },
  { path: 'src/nested/deep.ts', content: '// one\n// two\n// three\n' },
  { path: 'docs/readme.md', content: '# Readme\n' },
];

const FIXTURE_DIRECTORIES: readonly string[] = ['src', 'src/nested', 'src/empty', 'docs', 'empty'];

type StructureNode = Record<string, (string | StructureNode)[]>;

interface ExtractStructureData {
  readonly directoryPath: string;
  readonly depth: number;
  readonly structure: string;
}

interface SearchResponseData {
  readonly results: readonly {
    readonly path: string;
    readonly extension: string;
    readonly size: number;
  }[];
  readonly totalMatches: number;
  readonly truncated: boolean;
}

function expectedFileLabel(file: FixtureFile): string {
  const fileName = posix.basename(file.path);
  const trimmed = file.content.endsWith('\n') ? file.content.slice(0, -1) : file.content;
  const lineCount = trimmed.length === 0 ? 0 : trimmed.split('\n').length;

  return lineCount === 1
    ? `${fileName} (1 line)`
    : `${fileName} (${lineCount} lines)`;
}

function flattenStructure(
  children: readonly (string | StructureNode)[],
  prefix: string,
  files: Map<string, string>,
  directories: Set<string>,
): void {
  for (const child of children) {
    if (typeof child === 'string') {
      const match = /^(.+?) (?:\(\d+ lines?\)|\[binary\])$/u.exec(child);
      const fileName = match?.[1] ?? child;
      files.set(prefix === '' ? fileName : `${prefix}/${fileName}`, child);
      continue;
    }

    for (const [name, nested] of Object.entries(child)) {
      const nestedPath = prefix === '' ? name : `${prefix}/${name}`;
      directories.add(nestedPath);
      flattenStructure(nested, nestedPath, files, directories);
    }
  }
}

async function seedWorkspace(root: string): Promise<void> {
  for (const directory of FIXTURE_DIRECTORIES) {
    await mkdir(join(root, directory), { recursive: true });
  }

  for (const file of FIXTURES) {
    const absolutePath = join(root, file.path);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, file.content, 'utf8');
  }
}

describe('real environment execution invariant', () => {
  it('extracts the real structure and searches the real workspace through BrudTools', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'brud-leaf-real-environment-')));
    const kernel = createStandardKernel({
      storageDriver: new DurableNodeStorageDriver(),
      history: { dbPath: join(root, '.brud', 'history', 'universal.db') },
    });

    try {
      await seedWorkspace(root);
      await kernel.boot({ options: {...workspaceContextOptions(root)} });

      const caller: ServiceContext = {
        callerId: 'test.real-environment-execution',
        tier: 'core',
        options: {...workspaceContextOptions(root)},
      };
      const manager = kernel.requestAccess(caller, PluginManagerToken);
      const tools = kernel.requestAccess(caller, BrudToolsToken);

      const structure = await loadPluginModule<StructureModule>('Structure');
      const search = await loadPluginModule<SearchModule>('Search');

      manager.register(structure.createStructurePlugin());
      manager.register(search.createSearchPlugin());
      await manager.activateAll();

      assert.equal(manager.getPlugin(STRUCTURE_ID)?.state, 'active');
      assert.equal(manager.getPlugin(SEARCH_ID)?.state, 'active');

      // Dispatch is schema-only: no protocol `index` envelope is required.
      const extractResult = await tools.executeTool(
        'extract_structure',
        { directoryPath: 'src', depth: 0 },
        { workspaceRoot: root, callerId: caller.callerId },
      );

      assert.equal(extractResult.status, 'success', `extract_structure failed: ${String(extractResult.error)}`);
      const extractData = extractResult.data as ExtractStructureData;
      assert.equal(extractData.directoryPath, 'src');
      assert.equal(extractData.depth, 0);

      const parsed = JSON.parse(extractData.structure) as StructureNode;
      const rootEntries = Object.entries(parsed);
      assert.equal(rootEntries.length, 1, 'the structure must contain exactly one root node');

      const [rootKey, rootChildren] = rootEntries[0]!;
      assert.equal(rootKey, 'src', 'the root node must be labelled with the real target directory');

      const actualFiles = new Map<string, string>();
      const actualDirectories = new Set<string>();
      flattenStructure(rootChildren, 'src', actualFiles, actualDirectories);

      const expectedFiles = new Map(
        FIXTURES
          .filter((file) => file.path.startsWith('src/'))
          .map((file) => [file.path, expectedFileLabel(file)] as const),
      );

      assert.deepEqual(
        [...actualFiles.keys()].sort(),
        [...expectedFiles.keys()].sort(),
        'extract_structure must report exactly the files present on disk',
      );

      for (const [path, label] of expectedFiles) {
        assert.equal(
          actualFiles.get(path),
          label,
          `${path} must be reported with its real line count`,
        );
      }

      assert.deepEqual(
        [...actualDirectories].sort(),
        FIXTURE_DIRECTORIES.filter((directory) => directory.startsWith('src/')).sort(),
        'extract_structure must report exactly the directories present on disk',
      );
      assert.equal(actualDirectories.has('.brud'), false, 'hidden kernel state must not leak into the structure');

      const searchResult = await tools.executeTool(
        'search_files',
        { patterns: ['**/*.ts'] },
        { workspaceRoot: root, callerId: caller.callerId },
      );

      assert.equal(searchResult.status, 'success', `search_files failed: ${String(searchResult.error)}`);
      const searchData = searchResult.data as SearchResponseData;
      const expectedTsFiles = FIXTURES
        .filter((file) => file.path.endsWith('.ts'))
        .map((file) => file.path)
        .sort();

      assert.deepEqual(
        searchData.results.map((result) => result.path).sort(),
        expectedTsFiles,
        'search_files must return exactly the .ts files present on disk',
      );
      assert.equal(searchData.totalMatches, expectedTsFiles.length);
      assert.equal(searchData.truncated, false);

      for (const result of searchData.results) {
        const fixture = FIXTURES.find((file) => file.path === result.path);
        assert.ok(fixture, `unexpected search result: ${result.path}`);
        assert.equal(result.extension, '.ts');
        assert.equal(result.size, Buffer.byteLength(fixture.content), `${result.path} size must match disk`);
      }
    } finally {
      try {
        await kernel.shutdown();
      } finally {
        await safeRm(root);
      }
    }
  });
});
