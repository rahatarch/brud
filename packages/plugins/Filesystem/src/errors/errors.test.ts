import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapOsError, toFilesystemError } from './index.js';

function errno(code: string): Error {
  return Object.assign(new Error(code), { code });
}

describe('error taxonomy', () => {
  it('maps every OS errno the plugin expects', () => {
    const cases: Array<[string, string]> = [
      ['ENOENT', 'FILE_NOT_FOUND'],
      ['EEXIST', 'CONFLICT'],
      ['ENOTDIR', 'CONFLICT'],
      ['EACCES', 'VALIDATION_ERROR'],
      ['EPERM', 'VALIDATION_ERROR'],
      ['EXDEV', 'EXECUTION_FAILED'],
    ];

    for (const [errnoCode, expected] of cases) {
      assert.equal(mapOsError(errno(errnoCode), 'a.txt').code, expected, errnoCode);
    }
  });

  it('maps kernel filesystem codes onto the taxonomy', () => {
    assert.equal(
      toFilesystemError(Object.assign(new Error('exists'), { code: 'FILE_ALREADY_EXISTS' })).code,
      'CONFLICT',
    );
    assert.equal(
      toFilesystemError(Object.assign(new Error('missing'), { code: 'FILE_NOT_FOUND' })).code,
      'FILE_NOT_FOUND',
    );
    assert.equal(
      toFilesystemError(Object.assign(new Error('parent'), { code: 'PARENT_NOT_FOUND' })).code,
      'PARENT_NOT_FOUND',
    );
    assert.equal(
      toFilesystemError(Object.assign(new Error('file as dir'), {
        code: 'CANNOT_DELETE_FILE_AS_DIRECTORY',
      })).code,
      'CANNOT_DELETE_FILE_AS_DIRECTORY',
    );
  });

  it('maps workspace rules onto protected-path and containment codes', () => {
    assert.equal(
      toFilesystemError(Object.assign(new Error('denied'), {
        code: 'WORKSPACE_PATH_VIOLATION',
        rule: 'PROTECTED_PATH_DENIED',
      })).code,
      'PROTECTED_PATH_DENIED',
    );
    assert.equal(
      toFilesystemError(Object.assign(new Error('escape'), {
        code: 'WORKSPACE_PATH_VIOLATION',
        rule: 'SYMLINK_ESCAPE',
      })).code,
      'WORKSPACE_PATH_VIOLATION',
    );
    assert.equal(
      toFilesystemError(Object.assign(new Error('traversal'), {
        code: 'PATH_TRAVERSAL_DETECTED',
        rule: 'TRAVERSAL',
      })).code,
      'WORKSPACE_PATH_VIOLATION',
    );
  });

  it('falls back to EXECUTION_FAILED for unknown failures', () => {
    assert.equal(toFilesystemError(new Error('boom')).code, 'EXECUTION_FAILED');
  });
});