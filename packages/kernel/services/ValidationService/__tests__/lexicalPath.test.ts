import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeStorageDriver } from '../../../drivers/node/index.js';
import { isProtectedWritePath } from '../../BrudFileSystem/security/protectedPaths.js';
import { PathViolationError } from '../contracts/errors.js';
import { LexicalPathEngine } from '../engine/LexicalPathEngine.js';
import { assertSafeRelativePath, classifyPath } from '../engine/pathLexicon.js';

function isPathViolation(rule: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof PathViolationError && error.rule === rule;
}

describe('LexicalPathEngine — migrated canonical rules', () => {
  describe('posix flavor', () => {
    const engine = new LexicalPathEngine('/workspace', { flavor: 'posix' });

    it('resolves nested relative paths inside the boundary', () => {
      assert.equal(engine.resolve('notes/draft.md'), '/workspace/notes/draft.md');
      assert.equal(engine.resolve('./notes/./draft.md'), '/workspace/notes/draft.md');
      assert.equal(engine.resolve('notes/nested/'), '/workspace/notes/nested');
      assert.equal(engine.root, '/workspace');
      assert.equal(engine.flavor, 'posix');
    });

    it('maps the empty path and dot to the root', () => {
      assert.equal(engine.resolve(''), '/workspace');
      assert.equal(engine.resolve('.'), '/workspace');
    });

    it('permits dot-prefixed names that are not traversal segments', () => {
      assert.equal(engine.resolve('..config/settings.json'), '/workspace/..config/settings.json');
      assert.equal(engine.resolve('notes/.../file.txt'), '/workspace/notes/.../file.txt');
    });

    it('permits names that are reserved on Windows', () => {
      assert.equal(engine.resolve('nul.txt'), '/workspace/nul.txt');
      assert.equal(engine.resolve('CON'), '/workspace/CON');
      assert.equal(engine.resolve('file.txt:stream'), '/workspace/file.txt:stream');
    });

    it('always enforces PATH.NULL_BYTE', () => {
      assert.throws(() => engine.resolve('notes/\0hidden.txt'), isPathViolation('PATH.NULL_BYTE'));
    });

    it('rejects absolute, UNC, and drive-qualified forms', () => {
      assert.throws(() => engine.resolve('/etc/passwd'), isPathViolation('PATH.ABSOLUTE'));
      assert.throws(() => engine.resolve('//server/share/x'), isPathViolation('PATH.UNC_OR_DEVICE'));
      assert.throws(() => engine.resolve('\\\\server\\share\\x'), isPathViolation('PATH.UNC_OR_DEVICE'));
      assert.throws(() => engine.resolve('C:\\Windows'), isPathViolation('PATH.DRIVE_QUALIFIED'));
      assert.throws(() => engine.resolve('C:relative.txt'), isPathViolation('PATH.DRIVE_QUALIFIED'));
    });

    it('rejects parent segments in every separator form', () => {
      for (const candidate of ['../secret', 'notes/../../secret', 'notes/..', '..\\secret', 'notes\\..\\..\\x']) {
        assert.throws(() => engine.resolve(candidate), isPathViolation('PATH.PARENT_SEGMENT'));
      }
    });

    it('does not apply Windows segment rules on POSIX', () => {
      assert.equal(engine.resolve('notes/draft.'), '/workspace/notes/draft.');
      assert.equal(engine.resolve('notes/draft '), '/workspace/notes/draft ');
    });
  });

  describe('win32 flavor', () => {
    const engine = new LexicalPathEngine('C:\\workspace', { flavor: 'win32' });

    it('normalizes mixed separators inside the boundary', () => {
      assert.equal(engine.resolve('notes\\draft.md'), 'C:\\workspace\\notes\\draft.md');
      assert.equal(engine.resolve('notes/mixed\\draft.md'), 'C:\\workspace\\notes\\mixed\\draft.md');
      assert.equal(engine.resolve(''), 'C:\\workspace');
    });

    it('rejects traversal past the boundary', () => {
      for (const candidate of ['..\\secret', 'notes\\..\\..\\outside', 'notes/../../outside']) {
        assert.throws(() => engine.resolve(candidate), isPathViolation('PATH.PARENT_SEGMENT'));
      }
    });

    it('rejects trailing-space traversal aliases and trailing dots/spaces', () => {
      assert.throws(() => engine.resolve('.. \\secret'), isPathViolation('PATH.WIN_TRAILING_ALIAS_TRAVERSAL'));
      assert.throws(() => engine.resolve('notes\\draft.'), isPathViolation('PATH.WIN_TRAILING_DOT_OR_SPACE'));
      assert.throws(() => engine.resolve('notes\\draft '), isPathViolation('PATH.WIN_TRAILING_DOT_OR_SPACE'));
      assert.throws(() => engine.resolve('notes\\...\\file'), isPathViolation('PATH.WIN_TRAILING_ALIAS_TRAVERSAL'));
    });

    it('rejects reserved device names with or without extensions', () => {
      for (const candidate of ['nul', 'nul.txt', 'NUL.txt', 'CON', 'con.tar.gz', 'aux', 'COM1.txt', 'lpt9']) {
        assert.throws(() => engine.resolve(candidate), isPathViolation('PATH.WIN_RESERVED_DEVICE'));
      }
    });

    it('permits reserved-looking names Windows does not reserve', () => {
      assert.equal(engine.resolve('COM10.txt'), 'C:\\workspace\\COM10.txt');
      assert.equal(engine.resolve('console.txt'), 'C:\\workspace\\console.txt');
    });

    it('rejects alternate data streams', () => {
      for (const candidate of ['file.txt:stream', 'file.txt::$DATA', 'dir:stream\\file.txt']) {
        assert.throws(() => engine.resolve(candidate), isPathViolation('PATH.WIN_ALT_DATA_STREAM'));
      }
    });

    it('rejects absolute, drive-relative, and UNC paths', () => {
      for (const candidate of ['C:\\Windows', 'D:\\data\\x', 'D:relative.txt']) {
        assert.throws(() => engine.resolve(candidate), isPathViolation('PATH.DRIVE_QUALIFIED'));
      }

      for (const candidate of ['\\Windows', '/etc/passwd']) {
        assert.throws(() => engine.resolve(candidate), isPathViolation('PATH.ABSOLUTE'));
      }

      for (const candidate of ['\\\\server\\share\\x', '//server/share/x']) {
        assert.throws(() => engine.resolve(candidate), isPathViolation('PATH.UNC_OR_DEVICE'));
      }
    });
  });

  describe('classification', () => {
    it('classifies candidates by kind', () => {
      assert.equal(classifyPath('', 'posix').kind, 'root');
      assert.equal(classifyPath('.', 'posix').kind, 'root');
      assert.equal(classifyPath('/etc/passwd', 'posix').kind, 'absolute');
      assert.equal(classifyPath('notes/draft.md', 'posix').kind, 'relative');
      assert.equal(classifyPath('//server/share', 'posix').kind, 'ambiguous-absolute');
      assert.equal(classifyPath('\\\\??\\C:\\x', 'win32').kind, 'ambiguous-absolute');
      assert.equal(classifyPath('C:notes', 'win32').kind, 'ambiguous-absolute');
    });

    it('reports every rule verdict without throwing', () => {
      const engine = new LexicalPathEngine('/workspace', { flavor: 'posix' });
      const verdicts = engine.classify('../escape');

      assert.equal(verdicts.find((entry) => entry.rule === 'PATH.PARENT_SEGMENT')?.violated, true);
      assert.equal(verdicts.find((entry) => entry.rule === 'PATH.NULL_BYTE')?.violated, false);
    });

    it('counts the nine relative rule predicates', () => {
      const engine = new LexicalPathEngine('/workspace', { flavor: 'win32' });

      assert.equal(engine.classify('nul.txt').length, 9);
    });
  });

  describe('windows-only predicates stay flavor-gated (R-2)', () => {
    it('applies reserved devices and ADS only for win32', () => {
      const posix = new LexicalPathEngine('/workspace', { flavor: 'posix' });
      const win32 = new LexicalPathEngine('C:\\workspace', { flavor: 'win32' });

      assert.equal(posix.isContained('CON'), true);
      assert.equal(win32.isContained('CON'), false);
      assert.equal(posix.isContained('file.txt:stream'), true);
      assert.equal(win32.isContained('file.txt:stream'), false);
    });

    it('still enforces the flavor-independent rules on both', () => {
      for (const engine of [
        new LexicalPathEngine('/workspace', { flavor: 'posix' }),
        new LexicalPathEngine('C:\\workspace', { flavor: 'win32' }),
      ]) {
        assert.equal(engine.isContained('x\0y'), false);
        assert.equal(engine.isContained('../x'), false);
      }
    });
  });

  describe('root validation', () => {
    it('rejects relative, empty, and null-containing roots', () => {
      assert.throws(() => new LexicalPathEngine('relative/root', { flavor: 'posix' }), /absolute/);
      assert.throws(() => new LexicalPathEngine('', { flavor: 'posix' }), /non-empty/);
      assert.throws(() => new LexicalPathEngine('/ws\0x', { flavor: 'posix' }), /null bytes/);
    });

    it('normalizes trailing separators', () => {
      assert.equal(new LexicalPathEngine('/workspace/', { flavor: 'posix' }).root, '/workspace');
      assert.equal(new LexicalPathEngine('C:\\workspace\\', { flavor: 'win32' }).root, 'C:\\workspace');
    });
  });

  describe('diagnostics', () => {
    const engine = new LexicalPathEngine('/workspace', { flavor: 'posix' });

    it('reports rule, root, candidate, reason and legacy aliases', () => {
      try {
        engine.resolve('../secret.txt');
        assert.fail('expected a PathViolationError');
      } catch (error: unknown) {
        assert.ok(error instanceof PathViolationError);
        assert.equal(error.code, 'PATH_TRAVERSAL_DETECTED');
        assert.equal(error.rule, 'PATH.PARENT_SEGMENT');
        assert.equal(error.root, '/workspace');
        assert.equal(error.path, '../secret.txt');
        assert.ok(error.reason.length > 0);
      }
    });

    it('answers containment and tryResolve without throwing', () => {
      assert.equal(engine.isContained('notes/draft.md'), true);
      assert.equal(engine.isContained(''), true);
      assert.equal(engine.isContained('../secret.txt'), false);
      assert.deepEqual(engine.tryResolve('notes/draft.md'), { ok: true, path: '/workspace/notes/draft.md' });
    });
  });

  describe('A10 mutable-target predicate', () => {
    const engine = new LexicalPathEngine('/workspace', { flavor: 'posix' });

    it('denies protected paths and the workspace root', () => {
      for (const target of ['.brud/settings.json', '.brud/history/x', '.git/HEAD', '.GIT/config', '']) {
        assert.equal(engine.isMutableTarget(target), false, target);
      }
    });

    it('allows ordinary targets', () => {
      for (const target of ['src/index.ts', 'notes/draft.md', '.brud/other.json']) {
        assert.equal(engine.isMutableTarget(target), true, target);
      }
    });

    it('agrees with the filesystem denylist for every protected pattern', () => {
      for (const target of ['.brud/settings.json', '.brud/history', '.git', '.git/objects/x']) {
        assert.equal(engine.isMutableTarget(target), !isProtectedWritePath(target));
      }
    });
  });

  describe('symlink containment (V-2)', () => {
    const driver = new NodeStorageDriver();
    let rootDirectory = '';

    before(async () => {
      rootDirectory = await mkdtemp(join(tmpdir(), 'brud-lexical-engine-'));
    });

    after(async () => {
      await rm(rootDirectory, { recursive: true, force: true });
    });

    it('rejects a symlink that escapes the root', async (context) => {
      if (process.platform === 'win32') {
        context.skip('symlink creation requires elevated privileges on win32');
        return;
      }

      const workspace = join(rootDirectory, 'workspace');
      const outside = join(rootDirectory, 'outside');
      await mkdir(workspace, { recursive: true });
      await mkdir(outside, { recursive: true });
      await writeFile(join(outside, 'secret.txt'), 'TOP-SECRET');
      await symlink(outside, join(workspace, 'escape'), 'dir');

      const engine = new LexicalPathEngine(workspace, { flavor: 'posix' });

      await assert.rejects(
        engine.resolveContained('escape/secret.txt', driver),
        isPathViolation('PATH.SYMLINK_ESCAPE'),
      );
      await assert.rejects(
        engine.resolveContained('escape/new/deep/file.txt', driver),
        isPathViolation('PATH.SYMLINK_ESCAPE'),
      );
    });

    it('rejects a dangling symlink to a missing outside target', async (context) => {
      if (process.platform === 'win32') {
        context.skip('symlink creation requires elevated privileges on win32');
        return;
      }

      const workspace = join(rootDirectory, 'dangling-ws');
      const outside = join(rootDirectory, 'dangling-outside');
      await mkdir(workspace, { recursive: true });
      await mkdir(outside, { recursive: true });
      await symlink(join(outside, 'missing.txt'), join(workspace, 'dangling'));

      const engine = new LexicalPathEngine(workspace, { flavor: 'posix' });

      await assert.rejects(
        engine.resolveContained('dangling/deep/file.txt', driver),
        isPathViolation('PATH.SYMLINK_ESCAPE'),
      );
    });

    it('allows a symlink that stays inside the root', async (context) => {
      if (process.platform === 'win32') {
        context.skip('symlink creation requires elevated privileges on win32');
        return;
      }

      const workspace = join(rootDirectory, 'inner-ws');
      const realDirectory = join(workspace, 'real');
      await mkdir(realDirectory, { recursive: true });
      await writeFile(join(realDirectory, 'file.txt'), 'inside');
      await symlink(realDirectory, join(workspace, 'alias'), 'dir');

      const engine = new LexicalPathEngine(workspace, { flavor: 'posix' });

      assert.equal(
        await engine.resolveContained('alias/file.txt', driver),
        await realpath(join(realDirectory, 'file.txt')),
      );
    });

    it('resolves non-existent descendants through the nearest existing ancestor', async () => {
      const workspace = join(rootDirectory, 'nearest-ws');
      await mkdir(join(workspace, 'existing'), { recursive: true });

      const engine = new LexicalPathEngine(workspace, { flavor: 'posix' });

      assert.equal(
        await engine.resolveContained('existing/new/deep/file.txt', driver),
        join(await realpath(workspace), 'existing', 'new', 'deep', 'file.txt'),
      );
    });
  });
});

describe('pathLexicon — single-owner predicates', () => {
  it('exposes a throwing assertSafeRelativePath', () => {
    assert.equal(assertSafeRelativePath('notes/draft.md', 'posix'), 'notes/draft.md');
    assert.throws(() => assertSafeRelativePath('../x', 'posix'), PathViolationError);
  });

  it('keeps the workspace regex set reachable from one module', () => {
    const module = classifyPath('C:\\x', 'win32');

    assert.equal(module.kind, 'absolute');
  });
});
