import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as pathModule from 'path';
import { NodeFileSystem } from '../testing/nodeFileSystem.js';
import { readFiles } from './index.js';
import { validateWorkspacePath } from '../utils/workspacePath.js';
import { parseOperations } from '../parser/index.js';
import { executeFileOperations } from '../file-operations/index.js';
import { BrudError, BrudAPI } from '../api/index.js';

describe('readFiles integration tests', () => {
  let tempDir: string;
  let nodeFs: NodeFileSystem;

  before(async () => {
    tempDir = await fs.mkdtemp('/tmp/brud-read-test-');
    nodeFs = new NodeFileSystem();
  });

  after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('TEST 1: returns 1 file when main file has no imports', async () => {
    const fileA = pathModule.join(tempDir, 'a.ts');
    await nodeFs.writeFile(fileA, 'const x = 1;\nconsole.log(x);\n');

    const result = await readFiles(nodeFs, [fileA], true, 3);

    assert.strictEqual(result.totalFiles, 1);
    assert.strictEqual(result.files.length, 1);
    assert.strictEqual(result.files[0].path, fileA);
    assert.strictEqual(result.files[0].content, 'const x = 1;\nconsole.log(x);\n');
  });

  it('TEST 2: returns 2 files when main file imports another file', async () => {
    const fileA = pathModule.join(tempDir, 'a2.ts');
    const fileB = pathModule.join(tempDir, 'b2.ts');
    await nodeFs.writeFile(fileA, `import { helper } from './b2';\nconst x = 1;\n`);
    await nodeFs.writeFile(fileB, 'export function helper() { return 42; }\n');

    const result = await readFiles(nodeFs, [fileA], true, 3);

    assert.strictEqual(result.totalFiles, 2);
    assert.strictEqual(result.files.length, 2);
    const paths = result.files.map(f => f.path);
    assert.ok(paths.includes(fileA));
    assert.ok(paths.includes(fileB));
    const fileAEntry = result.files.find(f => f.path === fileA)!;
    const fileBEntry = result.files.find(f => f.path === fileB)!;
    assert.strictEqual(fileAEntry.content, `import { helper } from './b2';\nconst x = 1;\n`);
    assert.strictEqual(fileBEntry.content, 'export function helper() { return 42; }\n');
  });

  it('TEST 3: returns only main file when isImportRead is false', async () => {
    const fileA = pathModule.join(tempDir, 'a3.ts');
    const fileB = pathModule.join(tempDir, 'b3.ts');
    await nodeFs.writeFile(fileA, `import { helper } from './b3';\nconst x = 1;\n`);
    await nodeFs.writeFile(fileB, 'export function helper() { return 42; }\n');

    const result = await readFiles(nodeFs, [fileA], false, 3);

    assert.strictEqual(result.totalFiles, 1);
    assert.strictEqual(result.files.length, 1);
    assert.strictEqual(result.files[0].path, fileA);
  });

  it('TEST 4: respects maxDepth of 1 (A imports B, B imports C, only A+B returned)', async () => {
    const fileA = pathModule.join(tempDir, 'a4.ts');
    const fileB = pathModule.join(tempDir, 'b4.ts');
    const fileC = pathModule.join(tempDir, 'c4.ts');
    await nodeFs.writeFile(fileA, `import { fnB } from './b4';\nconst x = 1;\n`);
    await nodeFs.writeFile(fileB, `import { fnC } from './c4';\nexport function fnB() { return 1; }\n`);
    await nodeFs.writeFile(fileC, 'export function fnC() { return 2; }\n');

    const result = await readFiles(nodeFs, [fileA], true, 1);

    assert.strictEqual(result.totalFiles, 2);
    assert.strictEqual(result.files.length, 2);
    const paths = result.files.map(f => f.path);
    assert.ok(paths.includes(fileA));
    assert.ok(paths.includes(fileB));
    assert.ok(!paths.includes(fileC));
  });

  it('TEST 5: handles circular imports without infinite loop', async () => {
    const fileA = pathModule.join(tempDir, 'a5.ts');
    const fileB = pathModule.join(tempDir, 'b5.ts');
    await nodeFs.writeFile(fileA, `import { fnB } from './b5';\nexport function fnA() { return 1; }\n`);
    await nodeFs.writeFile(fileB, `import { fnA } from './a5';\nexport function fnB() { return 2; }\n`);

    const result = await readFiles(nodeFs, [fileA], true, 5);

    assert.strictEqual(result.totalFiles, 2);
    assert.strictEqual(result.files.length, 2);
    const paths = result.files.map(f => f.path);
    assert.ok(paths.includes(fileA));
    assert.ok(paths.includes(fileB));
  });

  it('TEST 6: readFiles with multiple file paths returns all of them', async () => {
    const fileA = pathModule.join(tempDir, 'a6.ts');
    const fileB = pathModule.join(tempDir, 'b6.ts');
    const fileC = pathModule.join(tempDir, 'c6.ts');
    await nodeFs.writeFile(fileA, '// file A\n');
    await nodeFs.writeFile(fileB, '// file B\n');
    await nodeFs.writeFile(fileC, '// file C\n');

    const result = await readFiles(nodeFs, [fileA, fileB, fileC], false, 3);

    assert.strictEqual(result.totalFiles, 3);
    assert.strictEqual(result.files.length, 3);
    const paths = result.files.map(f => f.path);
    assert.ok(paths.includes(fileA));
    assert.ok(paths.includes(fileB));
    assert.ok(paths.includes(fileC));
  });

  it('TEST 7: exclude patterns skip matched files', async () => {
    const fileA = pathModule.join(tempDir, 'a7.ts');
    const fileB = pathModule.join(tempDir, 'b7.ts');
    const fileC = pathModule.join(tempDir, 'c7.ts');
    await nodeFs.writeFile(fileA, `import { fnB } from './b7';\nimport { fnC } from './c7';\nconst x = 1;\n`);
    await nodeFs.writeFile(fileB, 'export function fnB() { return 1; }\n');
    await nodeFs.writeFile(fileC, 'export function fnC() { return 2; }\n');

    const result = await readFiles(nodeFs, [fileA], true, 3, ['c7']);

    assert.strictEqual(result.totalFiles, 2);
    assert.strictEqual(result.files.length, 2);
    const paths = result.files.map(f => f.path);
    assert.ok(paths.includes(fileA));
    assert.ok(paths.includes(fileB));
    assert.ok(!paths.includes(fileC));
  });

  it('TEST 8: validateWorkspacePath resolves relative paths against workspace folders', () => {
    const workspaceFolders = ['/media/rahathasan/ubuntu-dev1/dev_rahatarch/brud-test'];
    const input = 'src/history-test.ts';
    const result = validateWorkspacePath(input, workspaceFolders);
    assert.strictEqual(result.valid, true);
    if (result.valid) {
      assert.strictEqual(
        result.resolvedPath,
        '/media/rahathasan/ubuntu-dev1/dev_rahatarch/brud-test/src/history-test.ts',
      );
    }
  });

  it('TEST 9: validateWorkspacePath rejects paths outside workspace', () => {
    const workspaceFolders = ['/media/rahathasan/ubuntu-dev1/dev_rahatarch/brud-test'];
    const result = validateWorkspacePath('/etc/passwd', workspaceFolders);
    assert.strictEqual(result.valid, false);
    if (!result.valid) {
      assert.ok(result.error.includes('outside the current workspace'));
    }
  });

  it('TEST 10: full READ_FILE flow through parser and engine returns totalFiles >= 1', async () => {
    const fileA = pathModule.join(tempDir, 'integration_a.ts');
    await nodeFs.writeFile(fileA, 'const x = 42;\n');

    const ops = parseOperations(`<<<<<<< READ_FILE [integration-test]
File Path: ${fileA}
isImportRead: false
MaxDepth: 0
>>>>>>> END READ_FILE [integration-test]`);

    assert.strictEqual(ops.length, 1);
    assert.strictEqual(ops[0].kind, 'read_file');
    if (ops[0].kind === 'read_file') {
      assert.strictEqual(ops[0].path, fileA);
      assert.strictEqual(ops[0].isImportRead, false);
      assert.strictEqual(ops[0].maxDepth, 0);
    }

    const result = await executeFileOperations(ops, nodeFs, [tempDir]);
    assert.strictEqual(result.success, true);
    const parsed = JSON.parse(result.message);
    assert.ok(parsed.readResults, 'expected readResults in message');
    assert.ok(Array.isArray(parsed.readResults));
    assert.strictEqual(parsed.readResults.length, 1);
    assert.strictEqual(parsed.readResults[0].totalFiles, 1);
    assert.strictEqual(parsed.readResults[0].files.length, 1);
    assert.strictEqual(parsed.readResults[0].files[0].path, fileA);
    assert.strictEqual(parsed.readResults[0].files[0].content, 'const x = 42;\n');
  });

  it('TEST 11: full READ_FILE flow with isImportRead=true resolves imports', async () => {
    const fileA = pathModule.join(tempDir, 'integration_a2.ts');
    const fileB = pathModule.join(tempDir, 'integration_b2.ts');
    await nodeFs.writeFile(fileA, `import { helper } from './integration_b2';\nconst x = 42;\n`);
    await nodeFs.writeFile(fileB, 'export function helper() { return 1; }\n');

    const ops = parseOperations(`<<<<<<< READ_FILE [integration-test2]
File Path: ${fileA}
isImportRead: true
MaxDepth: 3
>>>>>>> END READ_FILE [integration-test2]`);

    assert.strictEqual(ops.length, 1);
    assert.strictEqual(ops[0].kind, 'read_file');
    if (ops[0].kind === 'read_file') {
      assert.strictEqual(ops[0].isImportRead, true);
      assert.strictEqual(ops[0].maxDepth, 3);
    }

    const result = await executeFileOperations(ops, nodeFs, [tempDir]);
    assert.strictEqual(result.success, true);
    const parsed = JSON.parse(result.message);
    assert.ok(parsed.readResults, 'expected readResults in message');
    assert.ok(Array.isArray(parsed.readResults));
    assert.strictEqual(parsed.readResults.length, 1);
    assert.strictEqual(parsed.readResults[0].totalFiles, 2);
    const paths = parsed.readResults[0].files.map((f: { path: string }) => f.path);
    assert.ok(paths.includes(fileA));
    assert.ok(paths.includes(fileB));
  });

  it('TEST 12: parseOperations (legacy format) with line range executes and slices content', async () => {
    const testFilePath = pathModule.join(tempDir, 'legacy-range-test-1.txt');
    await nodeFs.writeFile(testFilePath, 'line 1\nline 2\nline 3\nline 4\nline 5\n');

    const ops = parseOperations(`<<<<<<< READ_FILE [legacy-range-test-1]
File Path: ${testFilePath}
Start Line: 2
End Line: 4
>>>>>>> END READ_FILE [legacy-range-test-1]`);

    assert.strictEqual(ops.length, 1);
    assert.strictEqual(ops[0].kind, 'read_file');
    if (ops[0].kind === 'read_file') {
      assert.strictEqual(ops[0].start_line, 2);
      assert.strictEqual(ops[0].end_line, 4);
    }

    const result = await executeFileOperations(ops, nodeFs, [tempDir]);
    assert.strictEqual(result.success, true);
    const parsed = JSON.parse(result.message);
    assert.ok(parsed.readResults, 'expected readResults in message');
    assert.ok(Array.isArray(parsed.readResults));
    assert.strictEqual(parsed.readResults.length, 1);
    assert.strictEqual(parsed.readResults[0].files.length, 1);
    const fileEntry = parsed.readResults[0].files[0];
    assert.strictEqual(fileEntry.content, 'line 2\nline 3\nline 4\n');
    assert.strictEqual(fileEntry.startLine, 2);
    assert.strictEqual(fileEntry.endLine, 4);
    assert.strictEqual(fileEntry.totalLines, 5);
  });

  describe('line range slicing', () => {
    const fiveLineContent = 'line1\nline2\nline3\nline4\nline5\n';

    it('TEST L1: slicing with both bounds (lines 2-4 of a 5-line file)', async () => {
      const fp = pathModule.join(tempDir, 'l1.txt');
      await nodeFs.writeFile(fp, fiveLineContent);
      const result = await readFiles(nodeFs, [fp], false, 0, undefined, undefined, 2, 4);
      assert.strictEqual(result.files.length, 1);
      assert.strictEqual(result.files[0].content, 'line2\nline3\nline4\n');
      assert.strictEqual(result.files[0].startLine, 2);
      assert.strictEqual(result.files[0].endLine, 4);
      assert.strictEqual(result.files[0].totalLines, 5);
    });

    it('TEST L2: default start_line=1 when only end_line is specified', async () => {
      const fp = pathModule.join(tempDir, 'l2.txt');
      await nodeFs.writeFile(fp, fiveLineContent);
      const result = await readFiles(nodeFs, [fp], false, 0, undefined, undefined, undefined, 3);
      assert.strictEqual(result.files.length, 1);
      assert.strictEqual(result.files[0].content, 'line1\nline2\nline3\n');
      assert.strictEqual(result.files[0].startLine, 1);
      assert.strictEqual(result.files[0].endLine, 3);
    });

    it('TEST L3: default end_line=totalLines when only start_line is specified', async () => {
      const fp = pathModule.join(tempDir, 'l3.txt');
      await nodeFs.writeFile(fp, fiveLineContent);
      const result = await readFiles(nodeFs, [fp], false, 0, undefined, undefined, 3);
      assert.strictEqual(result.files.length, 1);
      assert.strictEqual(result.files[0].content, 'line3\nline4\nline5\n');
      assert.strictEqual(result.files[0].startLine, 3);
      assert.strictEqual(result.files[0].endLine, 5);
    });

    it('TEST L4: auto-clamping — end_line > totalLines clamps to EOF', async () => {
      const fp = pathModule.join(tempDir, 'l4.txt');
      await nodeFs.writeFile(fp, fiveLineContent);
      const result = await readFiles(nodeFs, [fp], false, 0, undefined, undefined, 3, 999);
      assert.strictEqual(result.files.length, 1);
      assert.strictEqual(result.files[0].content, 'line3\nline4\nline5\n');
      assert.strictEqual(result.files[0].startLine, 3);
      assert.strictEqual(result.files[0].endLine, 5);
    });

    it('TEST L5: validation failure — start_line < 1 throws INVALID_LINE_RANGE', async () => {
      const fp = pathModule.join(tempDir, 'l5.txt');
      await nodeFs.writeFile(fp, fiveLineContent);
      await assert.rejects(
        () => readFiles(nodeFs, [fp], false, 0, undefined, undefined, 0),
        (err: any) => err.code === 'INVALID_LINE_RANGE',
      );
    });

    it('TEST L6: validation failure — start_line > totalLines throws INVALID_LINE_RANGE', async () => {
      const fp = pathModule.join(tempDir, 'l6.txt');
      await nodeFs.writeFile(fp, fiveLineContent);
      await assert.rejects(
        () => readFiles(nodeFs, [fp], false, 0, undefined, undefined, 10),
        (err: any) => err.code === 'INVALID_LINE_RANGE',
      );
    });

    it('TEST L7: validation failure — start_line > end_line throws INVALID_LINE_RANGE', async () => {
      const fp = pathModule.join(tempDir, 'l7.txt');
      await nodeFs.writeFile(fp, fiveLineContent);
      await assert.rejects(
        () => readFiles(nodeFs, [fp], false, 0, undefined, undefined, 4, 2),
        (err: any) => err.code === 'INVALID_LINE_RANGE',
      );
    });

    it('TEST L8: import read — root file is sliced, dependency remains complete', async () => {
      const rootA = pathModule.join(tempDir, 'root_a.ts');
      const depB = pathModule.join(tempDir, 'dep_b.ts');
      await nodeFs.writeFile(rootA, `import { fn } from './dep_b';\nline2\nline3\nline4\nline5\n`);
      await nodeFs.writeFile(depB, 'lineX\nlineY\nlineZ\n');

      const result = await readFiles(nodeFs, [rootA], true, 3, undefined, undefined, 2, 4);

      assert.strictEqual(result.files.length, 2);
      const rootEntry = result.files.find(f => f.path === rootA)!;
      const depEntry = result.files.find(f => f.path === depB)!;

      assert.strictEqual(rootEntry.content, 'line2\nline3\nline4\n');
      assert.strictEqual(rootEntry.startLine, 2);
      assert.strictEqual(rootEntry.endLine, 4);
      assert.strictEqual(rootEntry.totalLines, 5);
      assert.strictEqual(rootEntry.isImported, undefined);

      assert.strictEqual(depEntry.content, 'lineX\nlineY\nlineZ\n');
      assert.strictEqual(depEntry.startLine, 1);
      assert.strictEqual(depEntry.endLine, 3);
      assert.strictEqual(depEntry.totalLines, 3);
      assert.strictEqual(depEntry.isImported, true);
    });
  });
});