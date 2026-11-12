import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceError } from '../contracts/errors.js';
import {
  assertSafeWorkspaceRelativePath,
  isAmbiguousAbsolutePath,
  isContainedInRoot,
  isFilesystemRootPath,
  normalizeRootPath,
  relativeWithinRoot,
  sharesTextualRootPrefix,
  toKernelSeparators,
} from './pathRules.js';

function ruleOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error: unknown) {
    if (error instanceof WorkspaceError) {
      return error.rule ?? 'UNSPECIFIED';
    }

    throw error;
  }

  return undefined;
}

describe('workspace path rules', () => {
  describe('segment-aware containment', () => {
    it('admits the root itself and descendants', () => {
      assert.equal(isContainedInRoot('/workspace', '/workspace', 'posix'), true);
      assert.equal(isContainedInRoot('/workspace', '/workspace/a/b.md', 'posix'), true);
      assert.equal(relativeWithinRoot('/workspace', '/workspace/a/b.md', 'posix'), 'a/b.md');
      assert.equal(relativeWithinRoot('/workspace', '/workspace', 'posix'), '');
    });

    it('rejects a sibling that shares a textual prefix', () => {
      assert.equal(isContainedInRoot('/workspace', '/workspace-evil/a.md', 'posix'), false);
      assert.equal(relativeWithinRoot('/workspace', '/workspace-evil/a.md', 'posix'), '../workspace-evil/a.md');
      assert.equal(sharesTextualRootPrefix('/workspace', '/workspace-evil/a.md', 'posix'), true);
    });

    it('rejects parents and unrelated roots', () => {
      assert.equal(isContainedInRoot('/workspace', '/etc/passwd', 'posix'), false);
      assert.equal(sharesTextualRootPrefix('/workspace', '/etc/passwd', 'posix'), false);
    });

    it('compares Windows roots case-insensitively and across drives', () => {
      assert.equal(isContainedInRoot('C:\\Work\\Ws', 'c:\\work\\ws\\a.md', 'win32'), true);
      assert.equal(isContainedInRoot('C:\\Work\\Ws', 'C:\\Work\\Ws-evil\\a.md', 'win32'), false);
      assert.equal(sharesTextualRootPrefix('C:\\Work\\Ws', 'c:\\work\\ws-evil\\a', 'win32'), true);
      assert.equal(isContainedInRoot('C:\\Work\\Ws', 'D:\\Work\\Ws\\a.md', 'win32'), false);
    });

    it('keeps POSIX comparisons case-sensitive', () => {
      assert.equal(isContainedInRoot('/workspace', '/Workspace/a.md', 'posix'), false);
    });
  });

  describe('root normalization', () => {
    it('strips trailing separators and resolves segments lexically', () => {
      assert.equal(normalizeRootPath('/workspace/', 'posix'), '/workspace');
      assert.equal(normalizeRootPath('/workspace/./a/../', 'posix'), '/workspace');
      assert.equal(normalizeRootPath('C:\\Users\\Dev\\Ws\\', 'win32'), 'C:\\Users\\Dev\\Ws');
    });

    it('upper-cases Windows drive letters so one root has one identity', () => {
      assert.equal(normalizeRootPath('c:\\Users\\Dev', 'win32'), 'C:\\Users\\Dev');
    });

    it('rejects relative, empty, and null-byte roots as configuration errors', () => {
      assert.equal(ruleOf(() => normalizeRootPath('relative/path', 'posix')), 'TRAVERSAL');
      assert.equal(ruleOf(() => normalizeRootPath('', 'posix')), 'INVALID_INPUT');
      assert.equal(ruleOf(() => normalizeRootPath('/work\u0000space', 'posix')), 'NULL_BYTE');
    });

    it('identifies filesystem and volume roots', () => {
      assert.equal(isFilesystemRootPath('/', 'posix'), true);
      assert.equal(isFilesystemRootPath('/workspace', 'posix'), false);
      assert.equal(isFilesystemRootPath('C:\\', 'win32'), true);
      assert.equal(isFilesystemRootPath('C:\\Users', 'win32'), false);
    });
  });

  describe('ambiguous absolute paths', () => {
    it('rejects UNC, device, and NT object prefixes for both flavors', () => {
      assert.equal(isAmbiguousAbsolutePath('//server/share/x', 'posix'), true);
      assert.equal(isAmbiguousAbsolutePath('\\\\server\\share\\x', 'win32'), true);
      assert.equal(isAmbiguousAbsolutePath('\\\\?\\C:\\x', 'win32'), true);
      assert.equal(isAmbiguousAbsolutePath('\\??\\C:\\x', 'win32'), true);
      assert.equal(isAmbiguousAbsolutePath('/workspace/a', 'posix'), false);
      assert.equal(isAmbiguousAbsolutePath('C:\\ws\\a', 'win32'), false);
    });

    it('rejects Windows drive-relative paths', () => {
      assert.equal(isAmbiguousAbsolutePath('C:notes', 'win32'), true);
      assert.equal(isAmbiguousAbsolutePath('C:/notes', 'win32'), false);
    });
  });

  describe('lexical rules shared with the filesystem validator', () => {
    it('rejects parent traversal and absolute inputs', () => {
      assert.equal(ruleOf(() => assertSafeWorkspaceRelativePath('../secret', 'posix')), 'TRAVERSAL');
      assert.equal(ruleOf(() => assertSafeWorkspaceRelativePath('a/../../b', 'posix')), 'TRAVERSAL');
      assert.equal(ruleOf(() => assertSafeWorkspaceRelativePath('/etc/passwd', 'posix')), 'TRAVERSAL');
    });

    it('rejects null bytes and UNC paths', () => {
      assert.equal(ruleOf(() => assertSafeWorkspaceRelativePath('a\u0000b', 'posix')), 'NULL_BYTE');
      assert.equal(ruleOf(() => assertSafeWorkspaceRelativePath('//server/share', 'posix')), 'TRAVERSAL');
    });

    it('rejects Windows reserved devices, ADS, and trailing dot/space aliases', () => {
      assert.equal(ruleOf(() => assertSafeWorkspaceRelativePath('nul', 'win32')), 'RESERVED_DEVICE');
      assert.equal(ruleOf(() => assertSafeWorkspaceRelativePath('CON.txt', 'win32')), 'RESERVED_DEVICE');
      assert.equal(ruleOf(() => assertSafeWorkspaceRelativePath('file.txt:stream', 'win32')), 'ALTERNATE_DATA_STREAM');
      assert.equal(ruleOf(() => assertSafeWorkspaceRelativePath('a.', 'win32')), 'TRAVERSAL');
      assert.equal(ruleOf(() => assertSafeWorkspaceRelativePath('.. \\secret', 'win32')), 'TRAVERSAL');
      assert.equal(assertSafeWorkspaceRelativePath('nul.txt', 'posix'), 'nul.txt');
    });

    it('accepts dot-prefixed names that are not traversal segments', () => {
      assert.equal(assertSafeWorkspaceRelativePath('..config/settings.json', 'posix'), '..config/settings.json');
    });
  });

  describe('kernel separator normalization', () => {
    it('always produces slash-separated relative paths', () => {
      assert.equal(toKernelSeparators('notes\\a.md', 'win32'), 'notes/a.md');
      assert.equal(toKernelSeparators('notes/a.md', 'posix'), 'notes/a.md');
      assert.equal(toKernelSeparators('.', 'posix'), '');
      assert.equal(toKernelSeparators('', 'win32'), '');
    });
  });
});
