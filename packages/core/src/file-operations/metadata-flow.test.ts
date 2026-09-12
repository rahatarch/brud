import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as pathModule from 'path';
import { NodeFileSystem } from '../testing/nodeFileSystem.js';
import { TestHistoryStore } from '../testing/testHistoryStore.js';
import { createTestWorkspace, cleanupTestWorkspace } from '../testing/testUtils.js';
import { executeFileOperations } from './index.js';
import { parseOperationsWithMetadata } from '../parser/index.js';
import { revertSession } from '../history/revert.js';

describe('Metadata flow: parser \u2192 execution \u2192 session.json', () => {
  let tempDir: string;
  let nodeFs: NodeFileSystem;
  let store: TestHistoryStore;
  let workspaceFolders: string[];

  before(async () => {
    tempDir = await createTestWorkspace('brud-metadata-flow-');
    nodeFs = new NodeFileSystem();
    store = new TestHistoryStore(tempDir, nodeFs);
    workspaceFolders = [tempDir];
  });

  after(async () => {
    await cleanupTestWorkspace(tempDir);
  });

  async function cleanTempDir() {
    const entries = await fs.readdir(tempDir);
    for (const entry of entries) {
      if (entry === '.brud') continue;
      await fs.rm(pathModule.join(tempDir, entry), { recursive: true, force: true });
    }
  }

  function resolve(relPath: string): string {
    return pathModule.join(tempDir, relPath);
  }

  async function writeFile(relPath: string, content: string): Promise<void> {
    await nodeFs.writeFile(resolve(relPath), content);
  }

  // ─────────────────────────────────────────────────
  // Test 1: Session metadata flows to session.json
  // ─────────────────────────────────────────────────
  it('Test 1: Session metadata flows to session.json', async () => {
    await cleanTempDir();
    const input = `<session_metadata>
title: My Session Title
description: My Session Description
</session_metadata>
<<<<<<< CREATE_FILE [1]
File Path: test1.txt
Content:
hello
=======
>>>>>>> END CREATE_FILE [1]`;

    const { operations, sessionMetadata } = parseOperationsWithMetadata(input, workspaceFolders);
    assert.ok(sessionMetadata);
    assert.strictEqual(sessionMetadata!.title, 'My Session Title');
    assert.strictEqual(sessionMetadata!.description, 'My Session Description');

    const result = await executeFileOperations(
      operations, nodeFs, workspaceFolders, store, 'test prompt', undefined, undefined, sessionMetadata,
    );
    assert.strictEqual(result.success, true);

    const entry = await store.getSession(result.sessionId!);
    assert.ok(entry);
    assert.strictEqual(entry.session.sessionTitle, 'My Session Title');
    assert.strictEqual(entry.session.sessionDescription, 'My Session Description');
  });

  // ─────────────────────────────────────────────────
  // Test 2: Operation metadata flows to session.json
  // ─────────────────────────────────────────────────
  it('Test 2: Operation metadata flows to session.json', async () => {
    await cleanTempDir();
    const input = `<<<<<<< CREATE_FILE [1]
<operation_metadata>
title: Create config
description: Creates the app config file
</operation_metadata>
File Path: test2.txt
Content:
hello
=======
>>>>>>> END CREATE_FILE [1]`;

    const { operations, sessionMetadata } = parseOperationsWithMetadata(input, workspaceFolders);
    assert.strictEqual(sessionMetadata, undefined);
    assert.strictEqual((operations[0] as any).title, 'Create config');

    const result = await executeFileOperations(
      operations, nodeFs, workspaceFolders, store, 'test prompt', undefined, undefined, sessionMetadata,
    );
    assert.strictEqual(result.success, true);

    const entry = await store.getSession(result.sessionId!);
    assert.ok(entry);
    assert.strictEqual(entry.session.operations[0].title, 'Create config');
    assert.strictEqual(entry.session.operations[0].description, 'Creates the app config file');
  });

  // ─────────────────────────────────────────────────
  // Test 3: Both session and operation metadata
  // ─────────────────────────────────────────────────
  it('Test 3: Both session and operation metadata', async () => {
    await cleanTempDir();
    const input = `<session_metadata>
title: Setup Project
description: Initial project setup
</session_metadata>
<<<<<<< CREATE_FILE [1]
<operation_metadata>
title: Create config
description: Creates config file
</operation_metadata>
File Path: test3.txt
Content:
hello
=======
>>>>>>> END CREATE_FILE [1]`;

    const { operations, sessionMetadata } = parseOperationsWithMetadata(input, workspaceFolders);
    assert.ok(sessionMetadata);
    assert.strictEqual(sessionMetadata!.title, 'Setup Project');

    const result = await executeFileOperations(
      operations, nodeFs, workspaceFolders, store, 'test prompt', undefined, undefined, sessionMetadata,
    );
    assert.strictEqual(result.success, true);

    const entry = await store.getSession(result.sessionId!);
    assert.ok(entry);
    assert.strictEqual(entry.session.sessionTitle, 'Setup Project');
    assert.strictEqual(entry.session.sessionDescription, 'Initial project setup');
    assert.strictEqual(entry.session.operations[0].title, 'Create config');
    assert.strictEqual(entry.session.operations[0].description, 'Creates config file');
  });

  // ─────────────────────────────────────────────────
  // Test 4: No metadata (baseline)
  // ─────────────────────────────────────────────────
  it('Test 4: No metadata (baseline)', async () => {
    await cleanTempDir();
    const input = `<<<<<<< CREATE_FILE [1]
File Path: test4.txt
Content:
hello
=======
>>>>>>> END CREATE_FILE [1]`;

    const { operations, sessionMetadata } = parseOperationsWithMetadata(input, workspaceFolders);
    assert.strictEqual(sessionMetadata, undefined);

    const result = await executeFileOperations(
      operations, nodeFs, workspaceFolders, store, 'test prompt', undefined, undefined, sessionMetadata,
    );
    assert.strictEqual(result.success, true);

    const entry = await store.getSession(result.sessionId!);
    assert.ok(entry);
    assert.strictEqual(entry.session.sessionTitle, undefined);
    assert.strictEqual(entry.session.sessionDescription, undefined);
    assert.strictEqual(entry.session.operations[0].title, undefined);
    assert.strictEqual(entry.session.operations[0].description, undefined);
  });

  // ─────────────────────────────────────────────────
  // Test 5: Session metadata only, no operation metadata
  // ─────────────────────────────────────────────────
  it('Test 5: Session metadata only, no operation metadata', async () => {
    await cleanTempDir();
    const input = `<session_metadata>
title: Session Only
description: Description only
</session_metadata>
<<<<<<< CREATE_FILE [1]
File Path: test5.txt
Content:
hello
=======
>>>>>>> END CREATE_FILE [1]`;

    const { operations, sessionMetadata } = parseOperationsWithMetadata(input, workspaceFolders);
    assert.ok(sessionMetadata);

    const result = await executeFileOperations(
      operations, nodeFs, workspaceFolders, store, 'test prompt', undefined, undefined, sessionMetadata,
    );
    assert.strictEqual(result.success, true);

    const entry = await store.getSession(result.sessionId!);
    assert.ok(entry);
    assert.strictEqual(entry.session.sessionTitle, 'Session Only');
    assert.strictEqual(entry.session.sessionDescription, 'Description only');
    assert.strictEqual(entry.session.operations[0].title, undefined);
  });

  // ─────────────────────────────────────────────────
  // Test 6: Operation metadata only, no session metadata
  // ─────────────────────────────────────────────────
  it('Test 6: Operation metadata only, no session metadata', async () => {
    await cleanTempDir();
    const input = `<<<<<<< CREATE_FILE [1]
<operation_metadata>
title: Op Only
description: Just operation
</operation_metadata>
File Path: test6.txt
Content:
hello
=======
>>>>>>> END CREATE_FILE [1]`;

    const { operations, sessionMetadata } = parseOperationsWithMetadata(input, workspaceFolders);
    assert.strictEqual(sessionMetadata, undefined);

    const result = await executeFileOperations(
      operations, nodeFs, workspaceFolders, store, 'test prompt', undefined, undefined, sessionMetadata,
    );
    assert.strictEqual(result.success, true);

    const entry = await store.getSession(result.sessionId!);
    assert.ok(entry);
    assert.strictEqual(entry.session.sessionTitle, undefined);
    assert.strictEqual(entry.session.operations[0].title, 'Op Only');
    assert.strictEqual(entry.session.operations[0].description, 'Just operation');
  });

  // ─────────────────────────────────────────────────
  // Test 7: Multiline description preserved
  // ─────────────────────────────────────────────────
  it('Test 7: Multiline description preserved', async () => {
    await cleanTempDir();
    const input = `<session_metadata>
title: Multi Line
description: First line
  Second line
  Third line
</session_metadata>
<<<<<<< CREATE_FILE [1]
File Path: test7.txt
Content:
hello
=======
>>>>>>> END CREATE_FILE [1]`;

    const { operations, sessionMetadata } = parseOperationsWithMetadata(input, workspaceFolders);
    assert.ok(sessionMetadata);
    assert.strictEqual(sessionMetadata!.description, 'First line\nSecond line\nThird line');

    const result = await executeFileOperations(
      operations, nodeFs, workspaceFolders, store, 'test prompt', undefined, undefined, sessionMetadata,
    );
    assert.strictEqual(result.success, true);

    const entry = await store.getSession(result.sessionId!);
    assert.ok(entry);
    assert.strictEqual(entry.session.sessionDescription, 'First line\nSecond line\nThird line');
  });

  // ─────────────────────────────────────────────────
  // Test 8: Unicode/Bengali/emoji in metadata
  // ─────────────────────────────────────────────────
  it('Test 8: Unicode/Bengali/emoji in metadata', async () => {
    await cleanTempDir();
    const input = `<session_metadata>
title: বাংলা শিরোনাম
description: This has emoji 🎉 and Unicode 文字
</session_metadata>
<<<<<<< CREATE_FILE [1]
File Path: test8.txt
Content:
hello
=======
>>>>>>> END CREATE_FILE [1]`;

    const { operations, sessionMetadata } = parseOperationsWithMetadata(input, workspaceFolders);
    assert.ok(sessionMetadata);
    assert.strictEqual(sessionMetadata!.title, 'বাংলা শিরোনাম');
    assert.strictEqual(sessionMetadata!.description, 'This has emoji 🎉 and Unicode 文字');

    const result = await executeFileOperations(
      operations, nodeFs, workspaceFolders, store, 'test prompt', undefined, undefined, sessionMetadata,
    );
    assert.strictEqual(result.success, true);

    const entry = await store.getSession(result.sessionId!);
    assert.ok(entry);
    assert.strictEqual(entry.session.sessionTitle, 'বাংলা শিরোনাম');
    assert.strictEqual(entry.session.sessionDescription, 'This has emoji 🎉 and Unicode 文字');
  });

  // ─────────────────────────────────────────────────
  // Test 9: Session metadata with multiple operations
  // ─────────────────────────────────────────────────
  it('Test 9: Session metadata with multiple operations', async () => {
    await cleanTempDir();
    await writeFile('existing.txt', 'original content');

    const input = `<session_metadata>
title: Multi Op Session
</session_metadata>
<<<<<<< SEARCH [1]
File Path: existing.txt
Search:
original content
Replace:
patched content
=======
>>>>>>> REPLACE [1]
<<<<<<< CREATE_FILE [2]
File Path: new1.txt
Content:
file1
=======
>>>>>>> END CREATE_FILE [2]
<<<<<<< CREATE_FILE [3]
File Path: new2.txt
Content:
file2
=======
>>>>>>> END CREATE_FILE [3]`;

    const { operations, sessionMetadata } = parseOperationsWithMetadata(input, workspaceFolders);
    assert.ok(sessionMetadata);
    assert.strictEqual(operations.length, 3);

    const result = await executeFileOperations(
      operations, nodeFs, workspaceFolders, store, 'test prompt', undefined, undefined, sessionMetadata,
    );
    assert.strictEqual(result.success, true);

    const entry = await store.getSession(result.sessionId!);
    assert.ok(entry);
    assert.strictEqual(entry.session.sessionTitle, 'Multi Op Session');
    assert.strictEqual(entry.session.operations.length, 3);
  });

  // ─────────────────────────────────────────────────
  // Test 10: Operation metadata on multiple operations
  // ─────────────────────────────────────────────────
  it('Test 10: Operation metadata on multiple operations', async () => {
    await cleanTempDir();
    await writeFile('file1.txt', 'content1');
    await writeFile('file2.txt', 'content2');

    const input = `<<<<<<< SEARCH [1]
<operation_metadata>
title: Fix file one
</operation_metadata>
File Path: file1.txt
Search:
content1
Replace:
patched1
=======
>>>>>>> REPLACE [1]
<<<<<<< SEARCH [2]
<operation_metadata>
title: Fix file two
description: Patching second file
</operation_metadata>
File Path: file2.txt
Search:
content2
Replace:
patched2
=======
>>>>>>> REPLACE [2]`;

    const { operations, sessionMetadata } = parseOperationsWithMetadata(input, workspaceFolders);
    assert.strictEqual(sessionMetadata, undefined);
    assert.strictEqual(operations.length, 2);
    assert.strictEqual((operations[0] as any).title, 'Fix file one');
    assert.strictEqual((operations[1] as any).title, 'Fix file two');
    assert.strictEqual((operations[1] as any).description, 'Patching second file');

    const result = await executeFileOperations(
      operations, nodeFs, workspaceFolders, store, 'test prompt', undefined, undefined, sessionMetadata,
    );
    assert.strictEqual(result.success, true);

    const entry = await store.getSession(result.sessionId!);
    assert.ok(entry);
    assert.strictEqual(entry.session.operations.length, 2);
    assert.strictEqual(entry.session.operations[0].title, 'Fix file one');
    assert.strictEqual(entry.session.operations[1].title, 'Fix file two');
    assert.strictEqual(entry.session.operations[1].description, 'Patching second file');
  });

  // ─────────────────────────────────────────────────
  // Test 11: Metadata survives session reload from disk
  // ─────────────────────────────────────────────────
  it('Test 11: Metadata survives session reload from disk', async () => {
    await cleanTempDir();
    const input = `<session_metadata>
title: Persistent Title
description: Persistent Description
</session_metadata>
<<<<<<< CREATE_FILE [1]
File Path: test11.txt
Content:
hello
=======
>>>>>>> END CREATE_FILE [1]`;

    const { operations, sessionMetadata } = parseOperationsWithMetadata(input, workspaceFolders);

    const result = await executeFileOperations(
      operations, nodeFs, workspaceFolders, store, 'test prompt', undefined, undefined, sessionMetadata,
    );
    assert.strictEqual(result.success, true);

    const freshStore = new TestHistoryStore(tempDir, nodeFs);
    const entry = await freshStore.getSession(result.sessionId!);
    assert.ok(entry);
    assert.strictEqual(entry.session.sessionTitle, 'Persistent Title');
    assert.strictEqual(entry.session.sessionDescription, 'Persistent Description');
  });

  // ─────────────────────────────────────────────────
  // Test 12: Metadata survives revert
  // ─────────────────────────────────────────────────
  it('Test 12: Metadata survives revert', async () => {
    await cleanTempDir();
    await writeFile('test12.txt', 'original');

    const input = `<session_metadata>
title: Revert Test
</session_metadata>
<<<<<<< SEARCH [1]
File Path: test12.txt
Search:
original
Replace:
patched
=======
>>>>>>> REPLACE [1]`;

    const { operations, sessionMetadata } = parseOperationsWithMetadata(input, workspaceFolders);

    const result = await executeFileOperations(
      operations, nodeFs, workspaceFolders, store, 'test prompt', undefined, undefined, sessionMetadata,
    );
    assert.strictEqual(result.success, true);

    const sessionId = result.sessionId!;
    let entry = await store.getSession(sessionId);
    assert.ok(entry);
    assert.strictEqual(entry.session.sessionTitle, 'Revert Test');

    await revertSession(entry, 'pre', nodeFs, workspaceFolders);

    entry = await store.getSession(sessionId);
    assert.ok(entry);
    assert.strictEqual(entry.session.sessionTitle, 'Revert Test',
      'Metadata must survive revert');
  });

  // ─────────────────────────────────────────────────
  // Test 13: Metadata survives restore after revert
  // ─────────────────────────────────────────────────
  it('Test 13: Metadata survives restore after revert', async () => {
    await cleanTempDir();
    await writeFile('test13.txt', 'original');

    const input = `<session_metadata>
title: Restore After Revert
</session_metadata>
<<<<<<< SEARCH [1]
File Path: test13.txt
Search:
original
Replace:
patched
=======
>>>>>>> REPLACE [1]`;

    const { operations, sessionMetadata } = parseOperationsWithMetadata(input, workspaceFolders);

    const result = await executeFileOperations(
      operations, nodeFs, workspaceFolders, store, 'test prompt', undefined, undefined, sessionMetadata,
    );
    assert.strictEqual(result.success, true);

    const sessionId = result.sessionId!;

    // Revert to pre
    let entry = await store.getSession(sessionId);
    assert.ok(entry);
    await revertSession(entry, 'pre', nodeFs, workspaceFolders);

    // Restore to post
    entry = await store.getSession(sessionId);
    assert.ok(entry);
    await revertSession(entry, 'post', nodeFs, workspaceFolders);

    entry = await store.getSession(sessionId);
    assert.ok(entry);
    assert.strictEqual(entry.session.sessionTitle, 'Restore After Revert',
      'Metadata must survive restore after revert');
  });

  // ─────────────────────────────────────────────────
  // Test 14: Metadata survives soft-delete and restore
  // ─────────────────────────────────────────────────
  it('Test 14: Metadata survives soft-delete and restore', async () => {
    await cleanTempDir();
    const input = `<session_metadata>
title: Soft Delete Test
</session_metadata>
<<<<<<< CREATE_FILE [1]
File Path: test14.txt
Content:
hello
=======
>>>>>>> END CREATE_FILE [1]`;

    const { operations, sessionMetadata } = parseOperationsWithMetadata(input, workspaceFolders);

    const result = await executeFileOperations(
      operations, nodeFs, workspaceFolders, store, 'test prompt', undefined, undefined, sessionMetadata,
    );
    assert.strictEqual(result.success, true);

    const sessionId = result.sessionId!;

    await store.softDeleteSession(sessionId, 'user', 'manual_delete');

    // Session should still be accessible from disk
    let entry = await store.getSession(sessionId);
    assert.ok(entry);
    assert.strictEqual(entry.session.sessionTitle, 'Soft Delete Test',
      'Metadata must survive soft-delete');
    assert.strictEqual(entry.session.isDeleted, true);

    await store.restoreSession(sessionId);

    entry = await store.getSession(sessionId);
    assert.ok(entry);
    assert.strictEqual(entry.session.sessionTitle, 'Soft Delete Test',
      'Metadata must survive restore after soft-delete');
    assert.strictEqual(entry.session.isDeleted, false);
  });

  // ─────────────────────────────────────────────────
  // Test 15: Invalid session metadata wrapper case rejects
  // ─────────────────────────────────────────────────
  it('Test 15: Invalid session metadata wrapper case rejects', () => {
    const input = `<Session_Metadata>
title: Test
</Session_Metadata>`;
    assert.throws(
      () => parseOperationsWithMetadata(input, workspaceFolders),
      (err: any) => err.code === 'E_METADATA_WRONG_CASE',
    );
  });

  // ─────────────────────────────────────────────────
  // Test 16: Duplicate session metadata rejects
  // ─────────────────────────────────────────────────
  it('Test 16: Duplicate session metadata rejects', () => {
    const input = `<session_metadata>
title: First
</session_metadata>
<session_metadata>
title: Second
</session_metadata>`;
    assert.throws(
      () => parseOperationsWithMetadata(input, workspaceFolders),
      (err: any) => err.code === 'E_DUPLICATE_SESSION_METADATA',
    );
  });

  // ─────────────────────────────────────────────────
  // Test 17: Invalid field case rejects
  // ─────────────────────────────────────────────────
  it('Test 17: Invalid field case rejects', () => {
    const input = `<session_metadata>
Title: My Session
</session_metadata>`;
    assert.throws(
      () => parseOperationsWithMetadata(input, workspaceFolders),
      (err: any) => err.code === 'E_METADATA_FIELD_CASE',
    );
  });

  // ─────────────────────────────────────────────────
  // Test 18: Unterminated metadata wrapper rejects
  // ─────────────────────────────────────────────────
  it('Test 18: Unterminated metadata wrapper rejects', () => {
    const input = `<session_metadata>
title: Unclosed
`;
    assert.throws(
      () => parseOperationsWithMetadata(input, workspaceFolders),
      (err: any) => err.code === 'E_METADATA_UNCLOSED',
    );
  });
});