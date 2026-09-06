import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isDangerousCommand } from './terminal.js';

describe('Terminal Validation - Dangerous Commands', () => {
  it('catches "rm -rf /"', () => {
    assert.strictEqual(isDangerousCommand('rm -rf /'), true);
  });

  it('catches "rm -rf ~"', () => {
    assert.strictEqual(isDangerousCommand('rm -rf ~'), true);
  });

  it('catches "rm -rf ."', () => {
    assert.strictEqual(isDangerousCommand('rm -rf .'), true);
  });

  it('catches "rm -fr /"', () => {
    assert.strictEqual(isDangerousCommand('rm -fr /'), true);
  });

  it('catches "sudo rm -rf /" (already caught by sudo pattern)', () => {
    assert.strictEqual(isDangerousCommand('sudo rm -rf /'), true);
  });

  it('does NOT catch "npm install"', () => {
    assert.strictEqual(isDangerousCommand('npm install'), false);
  });

  it('does NOT catch "rm -rf ./safe/path"', () => {
    assert.strictEqual(isDangerousCommand('rm -rf ./safe/path'), false);
  });
});