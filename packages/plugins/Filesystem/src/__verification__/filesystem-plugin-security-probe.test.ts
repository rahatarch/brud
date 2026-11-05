/**
 * Goal 6 — Security.
 *
 * Every one of the twelve tools is probed with traversal, absolute paths,
 * protected paths, NUL bytes, and a symlink escape. Destination checks are
 * probed separately for the dual-path tools.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import type { OperationResult } from '@brud/kernel';
import {
  acquireVerificationLock,
  bootVerificationKernel,
  errorCode,
  invoke,
  makeTempDirectory,
  readAbsolute,
  readReal,
  realExists,
  removeReal,
  releaseVerificationLock,
  symlinkReal,
  writeAbsolute,
  writeReal,
} from './support/harness.test.js';
import type { VerificationKernel } from './support/harness.test.js';

interface ToolCase {
  readonly name: string;
  readonly primary: (value: string) => Promise<OperationResult>;
}

let kernel: VerificationKernel;
let outside: string;

before(async () => {
  await acquireVerificationLock();
  kernel = await bootVerificationKernel({ prefix: 'brud-fs-verify-security-' });
  outside = await makeTempDirectory('brud-fs-security-outside-');
  await writeAbsolute(join(outside, 'secret.txt'), 'outside-secret');
  await symlinkReal(outside, join(kernel.root, 'escape'));
});

after(async () => {
  await kernel.shutdown();
  await removeReal(outside);
  await releaseVerificationLock();
});

const TOOLS: readonly ToolCase[] = [
  {
    name: 'create_file',
    primary: (value) => invoke(kernel, 'create_file', { path: value, content: 'x' }),
  },
  {
    name: 'delete_file',
    primary: (value) => invoke(kernel, 'delete_file', { path: value }),
  },
  {
    name: 'rename_file',
    primary: (value) => invoke(kernel, 'rename_file', {
      from: value,
      to: 'security/rename-destination.txt',
    }),
  },
  {
    name: 'move_file',
    primary: (value) => invoke(kernel, 'move_file', {
      from: value,
      to: 'security/move-destination.txt',
    }),
  },
  {
    name: 'copy_file',
    primary: (value) => invoke(kernel, 'copy_file', {
      from: value,
      to: 'security/copy-destination.txt',
    }),
  },
  {
    name: 'append_file',
    primary: (value) => invoke(kernel, 'append_file', { path: value, content: 'x' }),
  },
  {
    name: 'create_directory',
    primary: (value) => invoke(kernel, 'create_directory', { directoryPath: value }),
  },
  {
    name: 'delete_directory',
    primary: (value) => invoke(kernel, 'delete_directory', { directoryPath: value }),
  },
  {
    name: 'move_directory',
    primary: (value) => invoke(kernel, 'move_directory', {
      from: value,
      to: 'security/directory-destination',
    }),
  },
  {
    name: 'append_file_multi',
    primary: (value) => invoke(kernel, 'append_file_multi', {
      pattern: '**/*.txt',
      scope: value,
      content: 'x',
    }),
  },
  {
    name: 'search_replace',
    primary: (value) => invoke(kernel, 'search_replace', {
      path: value,
      search: 'a',
      replace: 'b',
    }),
  },
  {
    name: 'search_replace_multi',
    primary: (value) => invoke(kernel, 'search_replace_multi', {
      pattern: '**/*.txt',
      scope: value,
      search: 'a',
      replace: 'b',
    }),
  },
];

async function assertEveryToolRejects(
  value: string,
  code: string,
  label: string,
): Promise<void> {
  const failures: string[] = [];

  for (const tool of TOOLS) {
    const result = await tool.primary(value);
    const actual = errorCode(result);

    if (actual !== code) {
      failures.push(
        `${tool.name}: expected ${code}, got ${String(actual)} (status ${result.status})`,
      );
    }
  }

  assert.deepEqual(failures, [], `${label} must be rejected by every tool`);
}

describe('Goal 6 — path containment across all twelve tools', () => {
  it('rejects relative traversal with WORKSPACE_PATH_VIOLATION', async () => {
    await assertEveryToolRejects('../../etc/passwd', 'WORKSPACE_PATH_VIOLATION', 'traversal');
  });

  it('rejects absolute paths outside the root with WORKSPACE_PATH_VIOLATION', async () => {
    await assertEveryToolRejects('/etc/passwd', 'WORKSPACE_PATH_VIOLATION', 'absolute path');
  });

  it('rejects Windows-style absolute paths with WORKSPACE_PATH_VIOLATION', async () => {
    await assertEveryToolRejects('C:/Windows/system.ini', 'WORKSPACE_PATH_VIOLATION', 'Windows path');
  });

  it('rejects NUL bytes with WORKSPACE_PATH_VIOLATION', async () => {
    await assertEveryToolRejects('safe\0name.txt', 'WORKSPACE_PATH_VIOLATION', 'NUL byte');
  });

  it('rejects a symlink escape with WORKSPACE_PATH_VIOLATION', async () => {
    await assertEveryToolRejects(
      'escape/secret.txt',
      'WORKSPACE_PATH_VIOLATION',
      'symlink escape',
    );
  });

  it('rejects the kernel settings path with PROTECTED_PATH_DENIED', async () => {
    await assertEveryToolRejects(
      '.brud/settings.json',
      'PROTECTED_PATH_DENIED',
      'kernel settings',
    );
  });

  it('rejects the history ledger with PROTECTED_PATH_DENIED', async () => {
    await assertEveryToolRejects(
      '.brud/history/anything',
      'PROTECTED_PATH_DENIED',
      'history ledger',
    );
  });

  it('rejects git metadata with PROTECTED_PATH_DENIED', async () => {
    await assertEveryToolRejects('.git/config', 'PROTECTED_PATH_DENIED', 'git metadata');
  });

  it('rejects a mixed-case protected path after normalization', async () => {
    await assertEveryToolRejects('.GIT/config', 'PROTECTED_PATH_DENIED', 'case-folded git');
  });
});

describe('Goal 6 — dual-path destination checks', () => {
  before(async () => {
    await writeReal(kernel.root, 'security/source.txt', 'source');
    await writeReal(kernel.root, 'security/source-dir/file.txt', 'source');
  });

  const destinations: ReadonlyArray<{
    readonly name: string;
    readonly run: (destination: string) => Promise<OperationResult>;
  }> = [
    {
      name: 'rename_file',
      run: (destination) => invoke(kernel, 'rename_file', {
        from: 'security/source.txt',
        to: destination,
      }),
    },
    {
      name: 'move_file',
      run: (destination) => invoke(kernel, 'move_file', {
        from: 'security/source.txt',
        to: destination,
      }),
    },
    {
      name: 'copy_file',
      run: (destination) => invoke(kernel, 'copy_file', {
        from: 'security/source.txt',
        to: destination,
      }),
    },
    {
      name: 'move_directory',
      run: (destination) => invoke(kernel, 'move_directory', {
        from: 'security/source-dir',
        to: destination,
      }),
    },
  ];

  for (const tool of destinations) {
    it(`${tool.name} rejects a traversal destination`, async () => {
      const result = await tool.run('../../etc/passwd');

      assert.equal(errorCode(result), 'WORKSPACE_PATH_VIOLATION');
    });

    it(`${tool.name} rejects an absolute destination outside the root`, async () => {
      const result = await tool.run('/tmp/brud-outside-destination.txt');

      assert.equal(errorCode(result), 'WORKSPACE_PATH_VIOLATION');
    });

    it(`${tool.name} rejects a protected destination`, async () => {
      const result = await tool.run('.git/config');

      assert.equal(errorCode(result), 'PROTECTED_PATH_DENIED');
    });
  }

  it('copy_file cannot copy out of the workspace', async () => {
    const destination = join(outside, 'copied-out.txt');
    const result = await invoke(kernel, 'copy_file', {
      from: 'security/source.txt',
      to: destination,
    });

    assert.equal(errorCode(result), 'WORKSPACE_PATH_VIOLATION');
    assert.equal(await readReal(outside, 'copied-out.txt').catch(() => ''), '');
  });
});

describe('Goal 6 — per-file and glob containment', () => {
  it('create_directory rejects a traversal entry in files before any write', async () => {
    const result = await invoke(kernel, 'create_directory', {
      directoryPath: 'security/per-file',
      files: ['../../etc/passwd'],
    });

    assert.equal(errorCode(result), 'WORKSPACE_PATH_VIOLATION');
    assert.equal(await realExists(kernel.root, 'security/per-file'), false);
  });

  it('create_directory rejects a protected entry in files before any write', async () => {
    const result = await invoke(kernel, 'create_directory', {
      directoryPath: 'security/per-file-protected',
      files: ['.git/config'],
    });

    assert.equal(errorCode(result), 'PROTECTED_PATH_DENIED');
    assert.equal(await realExists(kernel.root, 'security/per-file-protected'), false);
  });

  it('create_directory returns a structured failure instead of throwing for an unsafe files entry', async () => {
    let thrown: unknown;
    let result: OperationResult | undefined;

    try {
      result = await invoke(kernel, 'create_directory', {
        directoryPath: 'security/per-file-structured',
        files: ['../../etc/passwd'],
      });
    } catch (error: unknown) {
      thrown = error;
    }

    assert.equal(
      thrown,
      undefined,
      `create_directory threw out of executeTool instead of returning a failure result: ${
        thrown instanceof Error ? thrown.message : String(thrown)
      }`,
    );
    assert.equal(errorCode(result as OperationResult), 'WORKSPACE_PATH_VIOLATION');
  });

  it('create_directory returns a structured failure instead of throwing for a protected files entry', async () => {
    let thrown: unknown;
    let result: OperationResult | undefined;

    try {
      result = await invoke(kernel, 'create_directory', {
        directoryPath: 'security/per-file-structured-protected',
        files: ['.git/config'],
      });
    } catch (error: unknown) {
      thrown = error;
    }

    assert.equal(
      thrown,
      undefined,
      `create_directory threw out of executeTool instead of returning a failure result: ${
        thrown instanceof Error ? thrown.message : String(thrown)
      }`,
    );
    assert.equal(errorCode(result as OperationResult), 'PROTECTED_PATH_DENIED');
  });

  it('a traversal glob does not escape the workspace', async () => {
    await writeReal(kernel.root, 'security/glob/inside.txt', 'inside');
    await writeAbsolute(join(outside, 'secret.txt'), 'outside-secret');

    const result = await invoke(kernel, 'append_file_multi', {
      pattern: '**/../../secret',
      scope: 'security/glob',
      content: 'SHOULD-NOT-APPEAR',
    });

    assert.equal(
      await readFileOutside('secret.txt'),
      'outside-secret',
      'the outside file must not be mutated',
    );
    assert.equal(
      await readReal(kernel.root, 'security/glob/inside.txt'),
      'inside',
      'the in-scope file must not be mutated by an escaping glob',
    );
    if (result.status === 'success') {
      assert.equal((result.data as { files?: unknown[] }).files?.length ?? 0, 0);
    }
  });

  it('a traversal glob in search_replace_multi does not escape', async () => {
    await writeReal(kernel.root, 'security/glob2/inside.txt', 'inside');
    await writeAbsolute(join(outside, 'secret.txt'), 'outside-secret');

    const result = await invoke(kernel, 'search_replace_multi', {
      pattern: '**/../../secret',
      scope: 'security/glob2',
      search: 'outside-secret',
      replace: 'TOUCHED',
    });

    assert.equal(await readFileOutside('secret.txt'), 'outside-secret');
    if (result.status === 'success') {
      assert.equal((result.data as { files?: unknown[] }).files?.length ?? 0, 0);
    }
  });
});

function readFileOutside(name: string): Promise<string> {
  return readAbsolute(join(outside, name));
}