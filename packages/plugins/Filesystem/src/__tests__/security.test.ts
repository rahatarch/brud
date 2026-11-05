import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OperationResult } from '@brud/kernel';
import { NodeStorageDriver } from '../../../../kernel/drivers/node/index.js';
import { appendFile } from '../groups/file/appendFile/index.js';
import { copyFile } from '../groups/file/copyFile/index.js';
import { createFile } from '../groups/file/createFile/index.js';
import { deleteFile } from '../groups/file/deleteFile/index.js';
import { moveFile } from '../groups/file/moveFile/index.js';
import { renameFile } from '../groups/file/renameFile/index.js';
import { createDirectory } from '../groups/directory/createDirectory/index.js';
import { deleteDirectory } from '../groups/directory/deleteDirectory/index.js';
import { moveDirectory } from '../groups/directory/moveDirectory/index.js';
import { appendFileMulti } from '../groups/multi/appendFileMulti/index.js';
import { searchReplace } from '../groups/multi/searchReplace/index.js';
import { searchReplaceMulti } from '../groups/multi/searchReplaceMulti/index.js';
import type { FilesystemRuntime } from '../runtime.js';
import {
  bootTestKernel,
  createRuntime,
  errorCode,
  fakeSearch,
} from './support/testHarness.js';
import type { TestKernel } from './support/testHarness.js';
import { acquireCrossTestLock, releaseCrossTestLock } from './support/serialLock.js';

interface ToolCase {
  readonly name: string;
  invoke(value: string): Promise<OperationResult>;
}

let kernel: TestKernel;
let runtime: FilesystemRuntime;
let outside: string;

before(async () => {
  await acquireCrossTestLock();
  kernel = await bootTestKernel({ prefix: 'brud-filesystem-security-', storageDriver: new NodeStorageDriver() });
  runtime = createRuntime(kernel, fakeSearch([]));
  outside = await mkdtemp(join(tmpdir(), 'brud-filesystem-outside-'));
  await writeFile(join(outside, 'secret.txt'), 'secret', 'utf8');
  await symlink(outside, join(kernel.root, 'escape'), 'dir');
});

after(async () => {
  await kernel.shutdown();
  await rm(outside, { recursive: true, force: true });
  await releaseCrossTestLock();
});

const TOOLS: readonly ToolCase[] = [
  {
    name: 'create_file',
    invoke: (value) => createFile({ path: value, content: 'x' }, runtime),
  },
  {
    name: 'delete_file',
    invoke: (value) => deleteFile({ path: value }, runtime),
  },
  {
    name: 'rename_file',
    invoke: (value) => renameFile({ from: value, to: 'safe-rename.txt' }, runtime),
  },
  {
    name: 'move_file',
    invoke: (value) => moveFile({ from: value, to: 'safe-move.txt' }, runtime),
  },
  {
    name: 'copy_file',
    invoke: (value) => copyFile({ from: value, to: 'safe-copy.txt' }, runtime),
  },
  {
    name: 'append_file',
    invoke: (value) => appendFile({ path: value, content: 'x' }, runtime),
  },
  {
    name: 'create_directory',
    invoke: (value) => createDirectory({ directoryPath: value }, runtime),
  },
  {
    name: 'delete_directory',
    invoke: (value) => deleteDirectory({ directoryPath: value }, runtime),
  },
  {
    name: 'move_directory',
    invoke: (value) => moveDirectory({ from: value, to: 'safe-directory' }, runtime),
  },
  {
    name: 'append_file_multi',
    invoke: (value) => appendFileMulti(
      { pattern: '**/*.txt', scope: value, content: 'x' },
      runtime,
    ),
  },
  {
    name: 'search_replace',
    invoke: (value) => searchReplace(
      { path: value, search: 'a', replace: 'b' },
      runtime,
    ),
  },
  {
    name: 'search_replace_multi',
    invoke: (value) => searchReplaceMulti(
      { pattern: '**/*.txt', scope: value, search: 'a', replace: 'b' },
      runtime,
    ),
  },
];

const MALICIOUS: ReadonlyArray<{
  readonly value: string;
  readonly code: string;
  readonly label: string;
}> = [
  {
    value: '../../../etc/passwd',
    code: 'WORKSPACE_PATH_VIOLATION',
    label: 'traversal',
  },
  {
    value: '.brud/settings.json',
    code: 'PROTECTED_PATH_DENIED',
    label: 'kernel settings',
  },
  {
    value: '.git/config',
    code: 'PROTECTED_PATH_DENIED',
    label: 'git metadata',
  },
  {
    value: 'safe\0name.txt',
    code: 'WORKSPACE_PATH_VIOLATION',
    label: 'NUL byte',
  },
  {
    value: 'escape/secret.txt',
    code: 'WORKSPACE_PATH_VIOLATION',
    label: 'symlink escape',
  },
];

describe('security invariants', () => {
  for (const malicious of MALICIOUS) {
    it(`every tool rejects ${malicious.label}`, async () => {
      for (const tool of TOOLS) {
        const result = await tool.invoke(malicious.value);

        assert.equal(
          errorCode(result),
          malicious.code,
          `${tool.name} must reject ${malicious.label} with ${malicious.code}`,
        );
      }
    });
  }
});