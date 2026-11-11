/**
 * Production-mirror coverage for D-01 on Windows.
 *
 * Every test uses the real daemon CLI as a child process, the real Windows
 * named pipe created by @cotal-ai/seat's prebuilt helper, a real connecting
 * process, and the operating system's client process identity (PID, token user
 * SID, and creation time). Nothing about the pipe, the helper, the verification,
 * or the OS is mocked.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import * as Protocol from '@brud/protocol';
import { REPO_ROOT, startAttackDaemon } from './harness.js';
import type { AttackDaemon } from './harness.js';

const WINDOWS = process.platform === 'win32';
const PROBE_PATH = resolve(__dirname, 'support', 'peerProbe.ts');

interface ProbeResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

async function runProbe(
  daemon: AttackDaemon,
  mode: 'raw' | 'client',
): Promise<ProbeResult> {
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      PROBE_PATH,
      mode,
      daemon.socketPath,
      daemon.workspaceRoot,
      daemon.token,
    ],
    {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let stdout = '';
  let stderr = '';

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  const [code] = await Promise.race([
    once(child, 'exit') as Promise<[number | null]>,
    new Promise<[number | null]>((resolveTimeout) => {
      setTimeout(() => {
        child.kill('SIGKILL');
        resolveTimeout([null]);
      }, 30_000).unref?.();
    }),
  ]);

  return { code, stdout, stderr };
}

function probePid(stdout: string): number {
  const match = /^PID:(\d+)$/m.exec(stdout);

  assert.ok(match !== null, `probe did not report its pid: ${stdout}`);

  return Number(match[1]);
}

async function waitForStderr(daemon: AttackDaemon, pattern: RegExp): Promise<void> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    if (pattern.test(daemon.stderr())) {
      return;
    }

    await new Promise<void>((resolveDelay) => {
      setTimeout(resolveDelay, 50);
    });
  }

  assert.fail(`daemon stderr did not match ${pattern}: ${daemon.stderr()}`);
}

async function assertParentCanConnect(daemon: AttackDaemon): Promise<void> {
  const pair = await daemon.connectAndHandshake();

  try {
    const response = await pair.client.request(Protocol.TOOLS_LIST, {});
    const result = response.result as Protocol.ToolsListResult | undefined;

    assert.equal(response.error, undefined, JSON.stringify(response));
    assert.ok(
      Array.isArray(result?.tools),
      'the expected parent must reach dispatch',
    );
  } finally {
    await pair.client.close();
  }
}

describe(
  'D-01 — Windows client process identity',
  { skip: WINDOWS ? false : `Windows only (this is ${process.platform})` },
  () => {
    let daemon: AttackDaemon;

    before(async () => {
      daemon = await startAttackDaemon({ prefix: 'brud-win-peer-' });
    });

    after(async () => {
      await daemon?.stop();
    });

    it('accepts the process that spawned the daemon', async () => {
      const pair = await daemon.connectAndHandshake();
      const response = await pair.client.request(Protocol.TOOLS_LIST, {});
      const result = response.result as Protocol.ToolsListResult | undefined;

      assert.equal(response.error, undefined, JSON.stringify(response));
      assert.ok(Array.isArray(result?.tools));

      await pair.client.close();
    });

    it('keeps the existing ownership check in the path and reports it as unsupported', async () => {
      await waitForStderr(
        daemon,
        /peer endpoint ownership is not verifiable on win32/,
      );
    });

    it('refuses another same-user process with a clear client-process identity error', async () => {
      const child = await runProbe(daemon, 'raw');
      const childPid = probePid(child.stdout);

      assert.equal(child.code, 0, child.stderr);
      assert.notEqual(childPid, process.pid, 'the probe must be a different process');
      assert.match(
        child.stdout,
        /brud-daemon: refused connection:/,
        `the daemon did not report a clear refusal: ${child.stdout}${child.stderr}`,
      );
      assert.match(
        child.stdout,
        new RegExp(
          `peer pid ${childPid} does not match the spawning host pid ${process.pid}`,
        ),
        `the refusal did not name the peer identity: ${child.stdout}`,
      );

      assert.equal(daemon.isAlive(), true, 'a refused connection must not stop the daemon');
      await assertParentCanConnect(daemon);
    });

    it('refuses a real secure-channel client from a different process', async () => {
      const child = await runProbe(daemon, 'client');

      assert.equal(child.code, 0, child.stderr);
      assert.match(
        child.stdout,
        /^REFUSED:/m,
        `the different process was not refused: ${child.stdout}${child.stderr}`,
      );
      assert.equal(
        child.stdout.includes('CONNECTED'),
        false,
        'a non-parent process completed the secure-channel handshake',
      );

      await assertParentCanConnect(daemon);
    });
  },
);