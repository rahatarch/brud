/**
 * Production-mirror coverage for D-01 peer credentials.
 *
 * Every test uses a real Unix-domain socket, a real daemon subprocess, a real
 * connecting process, and the operating system's peer-credential mechanism.
 * Nothing about the socket, the credential helper, the verification, or the
 * OS is mocked. Linux uses SO_PEERCRED; macOS uses LOCAL_PEERCRED and
 * LOCAL_PEERPID through the same prebuilt helper.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmod, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import * as Protocol from '@brud/protocol';
import { connectSocket } from '../client/socket.js';
import { REPO_ROOT, startAttackDaemon } from './harness.js';
import type { AttackDaemon } from './harness.js';

const SUPPORTED = process.platform === 'linux' || process.platform === 'darwin';
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
      }, 20_000).unref?.();
    }),
  ]);

  return { code, stdout, stderr };
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
  'D-01 — peer credentials on Linux and macOS',
  { skip: SUPPORTED ? false : `not implemented on ${process.platform}` },
  () => {
    let daemon: AttackDaemon;

    before(async () => {
      daemon = await startAttackDaemon({ prefix: 'brud-peercred-' });
    });

    after(async () => {
      await daemon?.stop();
    });

    it('accepts the process that spawned the daemon', async () => {
      assert.equal(daemon.process.pid !== undefined, true);

      const pair = await daemon.connectAndHandshake();
      const response = await pair.client.request(Protocol.TOOLS_LIST, {});
      const result = response.result as Protocol.ToolsListResult | undefined;

      assert.equal(response.error, undefined, JSON.stringify(response));
      assert.ok(Array.isArray(result?.tools));

      await pair.client.close();
    });

    it('keeps the owner-only endpoint as a second layer', async () => {
      const socket = await stat(daemon.socketPath);

      assert.equal(socket.uid, process.getuid?.());
      assert.equal(socket.mode & 0o077, 0, 'socket must not be group/world accessible');

      await chmod(daemon.socketPath, 0o666);

      try {
        await assert.rejects(
          () => connectSocket(daemon.socketPath),
          /insecure mode|ownership/i,
          'a reachable endpoint must still be refused by the ownership check',
        );
      } finally {
        await chmod(daemon.socketPath, 0o600);
      }

      await assertParentCanConnect(daemon);
    });

    it('refuses a same-user process with a clear peer-credential error', async () => {
      const child = await runProbe(daemon, 'raw');

      assert.equal(child.code, 0, child.stderr);
      assert.match(
        child.stdout,
        /brud-daemon: refused connection:/,
        `the daemon did not report a clear refusal: ${child.stdout}${child.stderr}`,
      );
      assert.match(
        child.stdout,
        /peer pid \d+ does not match the spawning host pid \d+/,
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