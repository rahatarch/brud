import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function readCanRender(data: any): boolean {
  return !!(data && data.files && Array.isArray(data.files) && data.files.length > 0);
}

function searchCanRender(data: any): boolean {
  return !!(data && data.results && Array.isArray(data.results));
}

function structureCanRender(data: any): boolean {
  return !!(data && typeof data.json === 'string');
}

function metadataCanRender(data: any): boolean {
  return !!(data && typeof data.root === 'string');
}

function terminalCanRender(data: any): boolean {
  function isGroupResultData(d: any): boolean {
    return !!(d && typeof d === 'object' && 'mode' in d && 'results' in d);
  }
  return !!(data && (isGroupResultData(data) || Array.isArray(data) || typeof data.command === 'string'));
}

function toolInfoCanRender(data: any): boolean {
  return !!(data && typeof data.message === 'string');
}

function errorCanRender(data: any): boolean {
  return !!(data && typeof data.friendlyMessage === 'string');
}

function operationResultCanRender(data: any): boolean {
  return !!(data && typeof data.status === 'string' && typeof data.kind === 'string');
}

describe('canRender contracts (logic tests)', () => {
  describe('readRenderer shape', () => {
    it('returns true for valid read data', () => {
      assert.equal(readCanRender({ files: [{ path: 'a.ts', content: 'x', size: 1 }] }), true);
    });
    it('returns false for empty files array', () => {
      assert.equal(readCanRender({ files: [] }), false);
    });
    it('returns false for missing files', () => {
      assert.equal(readCanRender({}), false);
    });
    it('returns false for null', () => {
      assert.equal(readCanRender(null), false);
    });
  });

  describe('searchRenderer shape', () => {
    it('returns true for valid search data', () => {
      assert.equal(searchCanRender({ results: [{ path: 'a.ts' }] }), true);
    });
    it('returns false for missing results', () => {
      assert.equal(searchCanRender({}), false);
    });
    it('returns false for non-array results', () => {
      assert.equal(searchCanRender({ results: 'string' }), false);
    });
  });

  describe('structureRenderer shape', () => {
    it('returns true for valid structure data', () => {
      assert.equal(structureCanRender({ json: '{}', directoryPath: '/', depth: 1 }), true);
    });
    it('returns false for missing json (non-string)', () => {
      assert.equal(structureCanRender({ json: 42 }), false);
    });
    it('returns false for null', () => {
      assert.equal(structureCanRender(null), false);
    });
  });

  describe('metadataRenderer shape', () => {
    it('returns true for valid metadata data', () => {
      assert.equal(metadataCanRender({ root: '/project', totalFiles: 10 }), true);
    });
    it('returns false when root is undefined', () => {
      assert.equal(metadataCanRender({ totalFiles: 10 }), false);
    });
    it('returns false for null', () => {
      assert.equal(metadataCanRender(null), false);
    });
  });

  describe('terminalRenderer shape', () => {
    it('returns true for single command', () => {
      assert.equal(terminalCanRender({ command: 'ls', output: '', exitCode: 0, duration: 100, success: true }), true);
    });
    it('returns true for group result', () => {
      assert.equal(terminalCanRender({ mode: 'sequential', results: [] }), true);
    });
    it('returns true for array', () => {
      assert.equal(terminalCanRender([{ command: 'ls', output: '', exitCode: 0, duration: 100, success: true }]), true);
    });
    it('returns false for null', () => {
      assert.equal(terminalCanRender(null), false);
    });
    it('returns false for empty object with no recognized shape', () => {
      assert.equal(terminalCanRender({}), false);
    });
  });

  describe('toolInfoRenderer shape', () => {
    it('returns true for valid tool info data', () => {
      assert.equal(toolInfoCanRender({ message: 'Tool is ready', status: 'success' }), true);
    });
    it('returns false for missing message', () => {
      assert.equal(toolInfoCanRender({ status: 'success' }), false);
    });
    it('returns false for null', () => {
      assert.equal(toolInfoCanRender(null), false);
    });
  });

  describe('errorRenderer shape', () => {
    it('returns true for valid error data', () => {
      assert.equal(errorCanRender({ friendlyMessage: 'Something went wrong' }), true);
    });
    it('returns false for missing friendlyMessage', () => {
      assert.equal(errorCanRender({}), false);
    });
    it('returns false for null', () => {
      assert.equal(errorCanRender(null), false);
    });
  });

  describe('operationResultRenderer shape (universal fallback)', () => {
    it('returns true for valid operation result', () => {
      assert.equal(operationResultCanRender({ status: 'success', kind: 'read_file' }), true);
    });
    it('returns false for missing status', () => {
      assert.equal(operationResultCanRender({ kind: 'read_file' }), false);
    });
    it('returns false for missing kind', () => {
      assert.equal(operationResultCanRender({ status: 'success' }), false);
    });
    it('returns false for null', () => {
      assert.equal(operationResultCanRender(null), false);
    });
  });

  describe('cross-renderer exclusivity', () => {
    it('read data is NOT handled by search shape', () => {
      assert.equal(searchCanRender({ files: [{ path: 'a.ts' }] }), false);
    });
    it('search data is NOT handled by read shape', () => {
      assert.equal(readCanRender({ results: ['a.ts'] }), false);
    });
    it('error data is NOT handled by toolInfo shape', () => {
      assert.equal(toolInfoCanRender({ friendlyMessage: 'error' }), false);
    });
    it('metadata data is NOT handled by structure shape', () => {
      assert.equal(structureCanRender({ root: '/project' }), false);
    });
    it('read data falls through to operationResult shape', () => {
      assert.equal(operationResultCanRender({ files: [{ path: 'a.ts' }] }), false);
    });
    it('terminal command data falls through to operationResult', () => {
      assert.equal(operationResultCanRender({ command: 'ls' }), false);
    });
  });
});