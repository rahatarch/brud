import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { FileSystem } from '../types/filesystem';
import { extractDirectoryStructure } from './index';

type DirEntry = { name: string; isDirectory: boolean };

class MockFileSystem implements FileSystem {
  private dirs: Map<string, DirEntry[]> = new Map();

  addDirectory(path: string, entries: DirEntry[]) {
    this.dirs.set(path, entries);
  }

  async readFile(_path: string): Promise<string> { throw new Error('Not implemented'); }
  async writeFile(_path: string, _content: string): Promise<void> { throw new Error('Not implemented'); }
  async deleteFile(_path: string): Promise<void> { throw new Error('Not implemented'); }
  async renameFile(_from: string, _to: string): Promise<void> { throw new Error('Not implemented'); }
  async copyFile(_from: string, _to: string): Promise<void> { throw new Error('Not implemented'); }
  async exists(_path: string): Promise<boolean> { throw new Error('Not implemented'); }
  async createDirectory(_path: string): Promise<void> { throw new Error('Not implemented'); }
  async deleteDirectoryRecursive(_path: string): Promise<void> { throw new Error('Not implemented'); }
  async moveDirectory(_from: string, _to: string): Promise<void> { throw new Error('Not implemented'); }
  async listDirectory(_path: string): Promise<string[]> { throw new Error('Not implemented'); }

  async listDirectoryContents(path: string): Promise<{ name: string; isDirectory: boolean }[]> {
    const entries = this.dirs.get(path);
    if (!entries) {
      throw new Error(`Directory not found: ${path}`);
    }
    return entries;
  }
}

function buildMockTree(): MockFileSystem {
  const fs = new MockFileSystem();
  fs.addDirectory('src', [
    { name: 'components', isDirectory: true },
    { name: 'utils', isDirectory: true },
    { name: 'index.ts', isDirectory: false },
    { name: 'node_modules', isDirectory: true },
    { name: '.hidden', isDirectory: true },
  ]);
  fs.addDirectory('src/components', [
    { name: 'Button.tsx', isDirectory: false },
    { name: 'Input.tsx', isDirectory: false },
    { name: 'forms', isDirectory: true },
  ]);
  fs.addDirectory('src/components/forms', [
    { name: 'LoginForm.tsx', isDirectory: false },
  ]);
  fs.addDirectory('src/utils', [
    { name: 'helper.ts', isDirectory: false },
    { name: 'constants.ts', isDirectory: false },
  ]);
  fs.addDirectory('src/node_modules', [
    { name: 'package1', isDirectory: true },
  ]);
  fs.addDirectory('src/node_modules/package1', []);
  fs.addDirectory('src/.hidden', [
    { name: 'secret.ts', isDirectory: false },
  ]);
  return fs;
}

describe('extractDirectoryStructure', () => {
  let mockFs: MockFileSystem;

  before(() => {
    mockFs = buildMockTree();
  });

  it('Test 1: Depth 0 (unlimited) - returns all directories and files excluding node_modules and .hidden', async () => {
    const result = await extractDirectoryStructure(mockFs, 'src', 0);
    const parsed = JSON.parse(result);
    assert.ok(parsed.src);
    const children = parsed.src;
    const childNames = children.map((c: any) => typeof c === 'string' ? c : Object.keys(c)[0]);
    assert.ok(childNames.includes('components'));
    assert.ok(childNames.includes('utils'));
    assert.ok(childNames.includes('index.ts'));
    assert.ok(!childNames.includes('node_modules'));
    assert.ok(!childNames.includes('.hidden'));
    const componentsObj = children.find((c: any) => typeof c === 'object' && c.components);
    assert.ok(componentsObj);
    const compChildren = componentsObj.components;
    const compNames = compChildren.map((c: any) => typeof c === 'string' ? c : Object.keys(c)[0]);
    assert.ok(compNames.includes('Button.tsx'));
    assert.ok(compNames.includes('Input.tsx'));
    assert.ok(compNames.includes('forms'));
    const formsObj = compChildren.find((c: any) => typeof c === 'object' && c.forms);
    assert.ok(formsObj);
    assert.ok(formsObj.forms.includes('LoginForm.tsx'));
  });

  it('Test 2: Depth 1 - only immediate children of src/ returned, subdirectories at boundary skipped', async () => {
    const result = await extractDirectoryStructure(mockFs, 'src', 1);
    const parsed = JSON.parse(result);
    const children = parsed.src;
    const childNames = children.map((c: any) => typeof c === 'string' ? c : Object.keys(c)[0]);
    assert.ok(childNames.includes('components'));
    assert.ok(childNames.includes('utils'));
    assert.ok(childNames.includes('index.ts'));
    const componentsList = children.find((c: any) => typeof c === 'object' && c.components);
    assert.ok(componentsList);
    const compChildren = componentsList.components;
    const compNames = compChildren.map((c: any) => typeof c === 'string' ? c : Object.keys(c)[0]);
    assert.ok(compNames.includes('Button.tsx'));
    assert.ok(compNames.includes('Input.tsx'));
    assert.ok(!compNames.includes('forms'), 'forms directory should not appear at depth 1');
  });

  it('Test 3: Depth 2 - components expanded to show forms/, but forms/ NOT expanded', async () => {
    const result = await extractDirectoryStructure(mockFs, 'src', 2);
    const parsed = JSON.parse(result);
    const children = parsed.src;
    const componentsObj = children.find((c: any) => typeof c === 'object' && c.components);
    assert.ok(componentsObj);
    const compChildren = componentsObj.components;
    const compNames = compChildren.map((c: any) => typeof c === 'string' ? c : Object.keys(c)[0]);
    assert.ok(compNames.includes('forms'));
    const formsEntry = compChildren.find((c: any) => typeof c === 'object' && c.forms);
    assert.ok(formsEntry, 'forms should be an expanded object at depth 2');
    assert.ok(Array.isArray(formsEntry.forms));
    assert.strictEqual(formsEntry.forms.length, 0, 'forms should not be expanded to show LoginForm.tsx at depth 2');
  });

  it('Test 4: Hidden and build directories excluded - node_modules and .hidden do not appear', async () => {
    const result = await extractDirectoryStructure(mockFs, 'src', 0);
    assert.ok(!result.includes('node_modules'));
    assert.ok(!result.includes('.hidden'));
  });

  it('Test 5: Output is valid JSON', async () => {
    const result = await extractDirectoryStructure(mockFs, 'src', 0);
    assert.doesNotThrow(() => JSON.parse(result));
  });
});