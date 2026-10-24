import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeStorageDriver } from '../../../../drivers/node/index.js';
import { PathTraversalViolationError, PathValidator } from './PathValidator.js';
import type { PathViolationRule } from './PathValidator.js';

function isTraversalViolation(error: unknown): boolean {
  return error instanceof PathTraversalViolationError
    && error.code === 'PATH_TRAVERSAL_DETECTED';
}

function hasRule(rule: PathViolationRule): (error: unknown) => boolean {
  return (error: unknown) => isTraversalViolation(error)
    && error instanceof PathTraversalViolationError
    && error.rule === rule;
}

describe('PathValidator', () => {
  describe('posix flavor', () => {
    const validator = new PathValidator('/workspace', { flavor: 'posix' });

    it('resolves nested relative paths inside the boundary', () => {
      assert.equal(validator.resolve('notes/draft.md'), '/workspace/notes/draft.md');
      assert.equal(validator.resolve('./notes/./draft.md'), '/workspace/notes/draft.md');
      assert.equal(validator.resolve('notes/nested/'), '/workspace/notes/nested');
      assert.equal(validator.root, '/workspace');
      assert.equal(validator.flavor, 'posix');
    });

    it('maps the empty path and dot to the workspace root', () => {
      assert.equal(validator.resolve(''), '/workspace');
      assert.equal(validator.resolve('.'), '/workspace');
      assert.equal(validator.validate('.'), '/workspace');
      assert.equal(validator.validate('notes/draft.md'), '/workspace/notes/draft.md');
    });

    it('permits dot-prefixed names that are not traversal segments', () => {
      assert.equal(validator.resolve('..config/settings.json'), '/workspace/..config/settings.json');
      assert.equal(validator.resolve('notes/.../file.txt'), '/workspace/notes/.../file.txt');
    });

    it('permits names that are reserved on Windows', () => {
      assert.equal(validator.resolve('nul.txt'), '/workspace/nul.txt');
      assert.equal(validator.resolve('CON'), '/workspace/CON');
      assert.equal(validator.resolve('file.txt:stream'), '/workspace/file.txt:stream');
    });

    it('rejects null bytes', () => {
      assert.throws(
        () => validator.resolve('notes/\0hidden.txt'),
        hasRule('NULL_BYTE'),
      );
    });

    it('rejects absolute paths', () => {
      assert.throws(() => validator.resolve('/etc/passwd'), hasRule('TRAVERSAL'));
    });

    it('rejects UNC paths', () => {
      assert.throws(() => validator.resolve('//server/share/file.txt'), hasRule('TRAVERSAL'));
      assert.throws(() => validator.resolve('\\\\server\\share\\file.txt'), hasRule('TRAVERSAL'));
    });

    it('rejects drive-qualified paths', () => {
      assert.throws(() => validator.resolve('C:\\Windows\\System32\\config'), hasRule('TRAVERSAL'));
      assert.throws(() => validator.resolve('C:relative.txt'), hasRule('TRAVERSAL'));
    });

    it('rejects traversal segments in every separator form', () => {
      assert.throws(() => validator.resolve('../secret.txt'), isTraversalViolation);
      assert.throws(() => validator.resolve('notes/../../secret.txt'), isTraversalViolation);
      assert.throws(() => validator.resolve('notes/..'), isTraversalViolation);
      assert.throws(() => validator.resolve('..\\secret.txt'), isTraversalViolation);
      assert.throws(() => validator.resolve('notes\\..\\..\\secret.txt'), isTraversalViolation);
    });
  });

  describe('win32 flavor', () => {
    const validator = new PathValidator('C:\\workspace', { flavor: 'win32' });

    it('resolves forward and backslash separated segments', () => {
      assert.equal(validator.resolve('notes\\draft.md'), 'C:\\workspace\\notes\\draft.md');
      assert.equal(validator.resolve('notes/draft.md'), 'C:\\workspace\\notes\\draft.md');
      assert.equal(validator.resolve('notes\\nested\\'), 'C:\\workspace\\notes\\nested');
      assert.equal(validator.resolve(''), 'C:\\workspace');
      assert.equal(validator.resolve('.'), 'C:\\workspace');
    });

    it('normalises mixed separators inside the boundary', () => {
      assert.equal(
        validator.resolve('notes/mixed\\draft.md'),
        'C:\\workspace\\notes\\mixed\\draft.md',
      );
    });

    it('rejects traversal past the workspace boundary', () => {
      assert.throws(() => validator.resolve('..\\secret.txt'), isTraversalViolation);
      assert.throws(() => validator.resolve('..\\..\\Windows\\System32'), isTraversalViolation);
      assert.throws(() => validator.resolve('notes\\..\\..\\outside.txt'), isTraversalViolation);
      assert.throws(() => validator.resolve('notes/../../outside.txt'), isTraversalViolation);
    });

    it('rejects trailing-space parent traversal aliases', () => {
      assert.throws(() => validator.resolve('.. \\secret.txt'), hasRule('TRAVERSAL'));
      assert.throws(() => validator.resolve('..\\secret.txt'), hasRule('TRAVERSAL'));
      assert.throws(() => validator.resolve('notes\\.. \\secret.txt'), hasRule('TRAVERSAL'));
    });

    it('rejects segments with trailing dots or spaces', () => {
      assert.throws(() => validator.resolve('notes\\draft.'), hasRule('TRAVERSAL'));
      assert.throws(() => validator.resolve('notes\\draft '), hasRule('TRAVERSAL'));
      assert.throws(() => validator.resolve('notes\\draft... '), hasRule('TRAVERSAL'));
      assert.throws(() => validator.resolve('notes\\...\\file.txt'), hasRule('TRAVERSAL'));
    });

    it('rejects reserved device names with or without extensions', () => {
      for (const candidate of ['nul', 'nul.txt', 'NUL.txt', 'CON', 'con.tar.gz', 'aux', 'COM1.txt', 'com1.json', 'lpt9']) {
        assert.throws(() => validator.resolve(candidate), hasRule('RESERVED_DEVICE'));
      }
    });

    it('still permits reserved-looking names that Windows does not reserve', () => {
      assert.equal(validator.resolve('COM10.txt'), 'C:\\workspace\\COM10.txt');
      assert.equal(validator.resolve('console.txt'), 'C:\\workspace\\console.txt');
    });

    it('rejects alternate data streams', () => {
      assert.throws(() => validator.resolve('file.txt:stream'), hasRule('ALTERNATE_DATA_STREAM'));
      assert.throws(() => validator.resolve('file.txt::$DATA'), hasRule('ALTERNATE_DATA_STREAM'));
      assert.throws(() => validator.resolve('dir:stream\\file.txt'), hasRule('ALTERNATE_DATA_STREAM'));
    });

    it('rejects absolute, drive-relative, and UNC paths', () => {
      assert.throws(() => validator.resolve('C:\\Windows\\System32\\config'), isTraversalViolation);
      assert.throws(() => validator.resolve('D:\\data\\secret.txt'), isTraversalViolation);
      assert.throws(() => validator.resolve('D:relative.txt'), isTraversalViolation);
      assert.throws(() => validator.resolve('\\Windows\\System32'), isTraversalViolation);
      assert.throws(() => validator.resolve('/etc/passwd'), isTraversalViolation);
      assert.throws(() => validator.resolve('\\\\server\\share\\file.txt'), isTraversalViolation);
      assert.throws(() => validator.resolve('//server/share/file.txt'), isTraversalViolation);
    });

    it('rejects null bytes', () => {
      assert.throws(() => validator.resolve('notes/\0hidden.txt'), hasRule('NULL_BYTE'));
    });
  });

  describe('root validation', () => {
    it('rejects relative roots', () => {
      assert.throws(
        () => new PathValidator('relative/root', { flavor: 'posix' }),
        /must be absolute/,
      );
    });

    it('rejects empty and null-containing roots', () => {
      assert.throws(() => new PathValidator('', { flavor: 'posix' }), /non-empty absolute/);
      assert.throws(() => new PathValidator('/workspace\0x', { flavor: 'posix' }), /null bytes/);
    });

    it('normalises trailing separators on the root', () => {
      assert.equal(new PathValidator('/workspace/', { flavor: 'posix' }).root, '/workspace');
      assert.equal(
        new PathValidator('C:\\workspace\\', { flavor: 'win32' }).root,
        'C:\\workspace',
      );
    });
  });

  describe('diagnostics', () => {
    const validator = new PathValidator('/workspace', { flavor: 'posix' });

    it('reports the violated rule, root, candidate, and reason', () => {
      try {
        validator.resolve('../secret.txt');
        assert.fail('expected a PathTraversalViolationError');
      } catch (error: unknown) {
        assert.ok(error instanceof PathTraversalViolationError);
        assert.equal(error.code, 'PATH_TRAVERSAL_DETECTED');
        assert.equal(error.rule, 'TRAVERSAL');
        assert.equal(error.root, '/workspace');
        assert.equal(error.candidatePath, '../secret.txt');
        assert.equal(error.path, '../secret.txt');
        assert.equal(typeof error.reason, 'string');
        assert.ok(error.reason.length > 0);
      }
    });

    it('reports TRAVERSAL for nested parent segments', () => {
      assert.throws(() => validator.resolve('a/../../b'), hasRule('TRAVERSAL'));
    });

    it('returns a failure result without throwing from tryResolve', () => {
      const result = validator.tryResolve('../secret.txt');

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.ok(result.error instanceof PathTraversalViolationError);
        assert.equal(result.error.rule, 'TRAVERSAL');
        assert.equal(result.error.root, '/workspace');
        assert.equal(result.error.candidatePath, '../secret.txt');
      }
    });

    it('returns a success result from tryResolve for contained paths', () => {
      const result = validator.tryResolve('notes/draft.md');

      assert.deepEqual(result, { ok: true, path: '/workspace/notes/draft.md' });
    });

    it('answers containment queries without throwing', () => {
      assert.equal(validator.isContained('notes/draft.md'), true);
      assert.equal(validator.isContained(''), true);
      assert.equal(validator.isContained('../secret.txt'), false);
      assert.equal(validator.isContained('/etc/passwd'), false);
      assert.equal(validator.isContained('notes/\0hidden.txt'), false);
    });
  });

  describe('symlink containment', () => {
    const driver = new NodeStorageDriver();
    let rootDirectory = '';

    before(async () => {
      rootDirectory = await mkdtemp(join(tmpdir(), 'brud-validator-'));
    });

    after(async () => {
      await rm(rootDirectory, { recursive: true, force: true });
    });

    it('rejects a symlink that escapes the workspace root', async (context) => {
      if (process.platform === 'win32') {
        context.skip('symlink creation requires elevated privileges on win32');
        return;
      }

      const workspace = join(rootDirectory, 'escape-workspace');
      const outside = join(rootDirectory, 'escape-outside');
      await mkdir(workspace, { recursive: true });
      await mkdir(outside, { recursive: true });
      await writeFile(join(outside, 'secret.txt'), 'TOP-SECRET');
      await symlink(outside, join(workspace, 'escape'), 'dir');

      const validator = new PathValidator(workspace, { flavor: 'posix' });

      await assert.rejects(
        validator.resolveContained('escape/secret.txt', driver),
        hasRule('SYMLINK_ESCAPE'),
      );
      await assert.rejects(
        validator.resolveContained('escape/new/deep/file.txt', driver),
        hasRule('SYMLINK_ESCAPE'),
      );
    });

    it('rejects a symlink to a sibling directory that shares a name prefix', async (context) => {
      if (process.platform === 'win32') {
        context.skip('symlink creation requires elevated privileges on win32');
        return;
      }

      const workspace = join(rootDirectory, 'prefix-workspace');
      const sibling = join(rootDirectory, 'prefix-workspace-evil');
      await mkdir(workspace, { recursive: true });
      await mkdir(sibling, { recursive: true });
      await writeFile(join(sibling, 'secret.txt'), 'TOP-SECRET');
      await symlink(sibling, join(workspace, 'sibling'), 'dir');

      const validator = new PathValidator(workspace, { flavor: 'posix' });

      await assert.rejects(
        validator.resolveContained('sibling/secret.txt', driver),
        hasRule('SYMLINK_ESCAPE'),
      );
    });

    it('rejects a dangling symlink to a non-existent outside target', async (context) => {
      if (process.platform === 'win32') {
        context.skip('symlink creation requires elevated privileges on win32');
        return;
      }

      const workspace = join(rootDirectory, 'dangling-workspace');
      const outside = join(rootDirectory, 'dangling-outside');
      await mkdir(workspace, { recursive: true });
      await mkdir(outside, { recursive: true });
      await symlink(join(outside, 'missing.txt'), join(workspace, 'dangling'));

      const validator = new PathValidator(workspace, { flavor: 'posix' });

      await assert.rejects(
        validator.resolveContained('dangling', driver),
        hasRule('SYMLINK_ESCAPE'),
      );
      await assert.rejects(
        validator.resolveContained('dangling/deep/file.txt', driver),
        hasRule('SYMLINK_ESCAPE'),
      );
    });

    it('allows a symlink that stays inside the workspace root', async (context) => {
      if (process.platform === 'win32') {
        context.skip('symlink creation requires elevated privileges on win32');
        return;
      }

      const workspace = join(rootDirectory, 'inner-workspace');
      const realDirectory = join(workspace, 'real');
      await mkdir(realDirectory, { recursive: true });
      await writeFile(join(realDirectory, 'file.txt'), 'inside');
      await symlink(realDirectory, join(workspace, 'alias'), 'dir');

      const validator = new PathValidator(workspace, { flavor: 'posix' });
      const resolved = await validator.resolveContained('alias/file.txt', driver);

      assert.equal(resolved, await realpath(join(realDirectory, 'file.txt')));
    });

    it('resolves non-existent descendants through the nearest existing ancestor', async () => {
      const workspace = join(rootDirectory, 'nearest-workspace');
      await mkdir(join(workspace, 'existing'), { recursive: true });

      const validator = new PathValidator(workspace, { flavor: 'posix' });
      const resolved = await validator.resolveContained('existing/new/deep/file.txt', driver);

      assert.equal(
        resolved,
        join(await realpath(workspace), 'existing', 'new', 'deep', 'file.txt'),
      );
    });

    it('maps the workspace root to its canonical real path', async () => {
      const workspace = join(rootDirectory, 'root-workspace');
      await mkdir(workspace, { recursive: true });

      const validator = new PathValidator(workspace, { flavor: 'posix' });

      assert.equal(await validator.resolveContained('', driver), await realpath(workspace));
    });
  });
});
