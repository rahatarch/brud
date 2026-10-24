import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as pathModule from 'path';
import { NodeFileSystem } from '../testing/nodeFileSystem.js';
import { extractDirectoryStructure } from './index.js';
import type { StructureNode } from './index.js';

function isStructureEntry(value: unknown): value is string | StructureNode {
  if (typeof value === 'string') {
    return true;
  }
  return isStructureNode(value);
}

function isStructureNode(value: unknown): value is StructureNode {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every(entries => Array.isArray(entries) && entries.every(isStructureEntry));
}

function parseStructure(raw: string): StructureNode {
  const value: unknown = JSON.parse(raw);
  if (!isStructureNode(value)) {
    throw new Error('Invalid structure output');
  }
  return value;
}

function findStructureNode(entries: (string | StructureNode)[], key: string): StructureNode | undefined {
  return entries.find((entry): entry is StructureNode => typeof entry === 'object' && key in entry);
}

async function createTestStructure(baseDir: string, nodeFs: NodeFileSystem): Promise<void> {
  await nodeFs.createDirectory(pathModule.join(baseDir, 'src', 'components', 'forms'));
  await nodeFs.createDirectory(pathModule.join(baseDir, 'src', 'utils'));
  await nodeFs.createDirectory(pathModule.join(baseDir, 'src', 'node_modules', 'package1'));
  await nodeFs.createDirectory(pathModule.join(baseDir, 'src', '.hidden'));
  await nodeFs.writeFile(pathModule.join(baseDir, 'src', 'index.ts'), '');
  await nodeFs.writeFile(pathModule.join(baseDir, 'src', 'components', 'Button.tsx'), '');
  await nodeFs.writeFile(pathModule.join(baseDir, 'src', 'components', 'Input.tsx'), '');
  await nodeFs.writeFile(pathModule.join(baseDir, 'src', 'components', 'forms', 'LoginForm.tsx'), '');
  await nodeFs.writeFile(pathModule.join(baseDir, 'src', 'utils', 'helper.ts'), '');
  await nodeFs.writeFile(pathModule.join(baseDir, 'src', 'utils', 'constants.ts'), '');
  await nodeFs.writeFile(pathModule.join(baseDir, 'src', '.hidden', 'secret.ts'), '');
  await nodeFs.writeFile(pathModule.join(baseDir, 'src', 'components', 'Header.tsx'), 'export function Header() {\n  return <header>Hello</header>;\n}\n');
  await nodeFs.writeFile(pathModule.join(baseDir, 'src', 'utils', 'calc.ts'), 'export function add(a: number, b: number): number {\n  return a + b;\n}');
  await nodeFs.writeFile(pathModule.join(baseDir, 'src', 'components', 'Layout.tsx'), '');
  await nodeFs.writeFile(pathModule.join(baseDir, 'src', 'empty.txt'), '');
  await nodeFs.writeFile(pathModule.join(baseDir, 'src', 'single.txt'), 'just one line');
  await nodeFs.writeFile(pathModule.join(baseDir, 'src', 'image.png'), '\u0089PNG\r\n\u001a\n');
}

describe('extractDirectoryStructure', () => {
  let tempDir: string;
  let nodeFs: NodeFileSystem;

  before(async () => {
    tempDir = await fs.mkdtemp('/tmp/brud-structure-test-');
    nodeFs = new NodeFileSystem();
    await createTestStructure(tempDir, nodeFs);
  });

  after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('Test 1: Depth 0 (unlimited) - returns all directories and files excluding node_modules and .hidden', async () => {
    const result = await extractDirectoryStructure(nodeFs, pathModule.join(tempDir, 'src'), 0);
    const parsed = parseStructure(result);
    const srcKey = pathModule.basename(pathModule.join(tempDir, 'src'));
    assert.ok(parsed[srcKey]);
    const children = parsed[srcKey];
    const childNames = children.map((c) => typeof c === 'string' ? c : Object.keys(c)[0]);
    assert.ok(childNames.includes('components'));
    assert.ok(childNames.includes('utils'));
    assert.ok(childNames.includes('index.ts (0 lines)'));
    assert.ok(childNames.includes('empty.txt (0 lines)'));
    assert.ok(childNames.includes('single.txt (1 line)'));
    assert.ok(childNames.includes('image.png [binary]'));
    assert.ok(!childNames.includes('node_modules'));
    assert.ok(!childNames.includes('.hidden'));
    const componentsObj = findStructureNode(children, 'components');
    assert.ok(componentsObj);
    const compChildren = componentsObj.components;
    const compNames = compChildren.map((c) => typeof c === 'string' ? c : Object.keys(c)[0]);
    assert.ok(compNames.includes('Button.tsx (0 lines)'));
    assert.ok(compNames.includes('Input.tsx (0 lines)'));
    assert.ok(compNames.includes('Layout.tsx (0 lines)'));
    assert.ok(compNames.includes('Header.tsx (3 lines)'));
    assert.ok(compNames.includes('forms'));
    const formsObj = findStructureNode(compChildren, 'forms');
    assert.ok(formsObj);
    assert.ok(formsObj.forms.includes('LoginForm.tsx (0 lines)'));
  });

  it('Test 2: Depth 1 - only immediate children of src/ returned, subdirectories at boundary skipped', async () => {
    const result = await extractDirectoryStructure(nodeFs, pathModule.join(tempDir, 'src'), 1);
    const parsed = parseStructure(result);
    const srcKey = pathModule.basename(pathModule.join(tempDir, 'src'));
    const children = parsed[srcKey];
    const childNames = children.map((c) => typeof c === 'string' ? c : Object.keys(c)[0]);
    assert.ok(childNames.includes('components'));
    assert.ok(childNames.includes('utils'));
    assert.ok(childNames.includes('index.ts (0 lines)'));
    const componentsList = findStructureNode(children, 'components');
    assert.ok(componentsList);
    const compChildren = componentsList.components;
    const compNames = compChildren.map((c) => typeof c === 'string' ? c : Object.keys(c)[0]);
    assert.ok(compNames.includes('Button.tsx (0 lines)'));
    assert.ok(compNames.includes('Input.tsx (0 lines)'));
    assert.ok(!compNames.includes('forms'), 'forms directory should not appear at depth 1');
  });

  it('Test 3: Depth 2 - components expanded to show forms/, but forms/ NOT expanded', async () => {
    const result = await extractDirectoryStructure(nodeFs, pathModule.join(tempDir, 'src'), 2);
    const parsed = parseStructure(result);
    const srcKey = pathModule.basename(pathModule.join(tempDir, 'src'));
    const children = parsed[srcKey];
    const componentsObj = findStructureNode(children, 'components');
    assert.ok(componentsObj);
    const compChildren = componentsObj.components;
    const compNames = compChildren.map((c) => typeof c === 'string' ? c : Object.keys(c)[0]);
    assert.ok(compNames.includes('forms'));
    const formsEntry = findStructureNode(compChildren, 'forms');
    assert.ok(formsEntry, 'forms should be an expanded object at depth 2');
    assert.ok(Array.isArray(formsEntry.forms));
    assert.strictEqual(formsEntry.forms.length, 0, 'forms should not be expanded to show LoginForm.tsx at depth 2');
  });

  it('Test 4: Hidden and build directories excluded - node_modules and .hidden do not appear', async () => {
    const result = await extractDirectoryStructure(nodeFs, pathModule.join(tempDir, 'src'), 0);
    assert.ok(!result.includes('node_modules'));
    assert.ok(!result.includes('.hidden'));
  });

  it('Test 5: Output is valid JSON', async () => {
    const result = await extractDirectoryStructure(nodeFs, pathModule.join(tempDir, 'src'), 0);
    assert.doesNotThrow(() => JSON.parse(result));
  });

  it('Test 6: Non-empty text file reports line count', async () => {
    const result = await extractDirectoryStructure(nodeFs, pathModule.join(tempDir, 'src'), 0);
    assert.ok(result.includes('Header.tsx (3 lines)'));
    assert.ok(result.includes('single.txt (1 line)'));
  });

  it('Test 7: Empty text file reports (0 lines)', async () => {
    const result = await extractDirectoryStructure(nodeFs, pathModule.join(tempDir, 'src'), 0);
    assert.ok(result.includes('empty.txt (0 lines)'));
  });

  it('Test 8: Binary file reports [binary] tag', async () => {
    const result = await extractDirectoryStructure(nodeFs, pathModule.join(tempDir, 'src'), 0);
    assert.ok(result.includes('image.png [binary]'));
  });
});