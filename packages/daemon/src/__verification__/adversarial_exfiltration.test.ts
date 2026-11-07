/**
 * Phase 13.0 — Category 3: storage and exfiltration attacks.
 *
 * These attacks try to read the history ledger, delete the workspace policy
 * file, and escape the workspace with lexical traversal and a NUL byte.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as Protocol from '@brud/protocol';
import { startAttackDaemon, toolResultOf } from './harness.js';
import type { AttackDaemon, RawJsonRpcClient } from './harness.js';

let daemon: AttackDaemon;
let client: RawJsonRpcClient;

before(async () => {
  daemon = await startAttackDaemon({ prefix: 'brud-redteam-exfil-' });
  const pair = await daemon.connectAndHandshake();

  client = pair.client;
});

after(async () => {
  await client?.close().catch(() => undefined);
  await daemon?.stop();
});

async function execute(name: string, input: unknown): Promise<ReturnType<typeof toolResultOf>> {
  const response = await client.request(Protocol.TOOLS_EXECUTE, { name, input });

  assert.equal(response.error, undefined, JSON.stringify(response));

  return toolResultOf(response);
}

function describeResult(result: ReturnType<typeof toolResultOf>): string {
  return JSON.stringify(result);
}

describe('Attack 9 — The .brud/history Heist', () => {
  it('denies read_file access to the universal history database', async () => {
    const result = await execute('read_file', { filePath: '.brud/history/universal.db' });

    assert.equal(
      result.status,
      'failed',
      `history ledger was readable through read_file: ${describeResult(result)}`,
    );
    assert.match(
      describeResult(result),
      /PROTECTED_PATH_DENIED/u,
      `expected PROTECTED_PATH_DENIED: ${describeResult(result)}`,
    );
  });

  it('denies read_file access to the history directory listing', async () => {
    const result = await execute('read_directory', {
      directoryPath: '.brud/history',
      recursive: true,
    });

    assert.equal(
      result.status,
      'failed',
      `history directory was listable through read_directory: ${describeResult(result)}`,
    );
    assert.match(
      describeResult(result),
      /PROTECTED_PATH_DENIED/u,
      `expected PROTECTED_PATH_DENIED: ${describeResult(result)}`,
    );
  });
});

describe('Attack 10 — The .brudignore Self-Destruction', () => {
  it('denies delete_file on .brudignore and leaves the file intact', async () => {
    const target = join(daemon.workspaceRoot, '.brudignore');

    assert.equal(existsSync(target), true, 'harness must seed .brudignore');

    const result = await execute('delete_file', { path: '.brudignore' });

    assert.notEqual(
      result.status,
      'success',
      `delete_file removed .brudignore: ${describeResult(result)}`,
    );
    assert.match(
      describeResult(result),
      /PROTECTED_PATH_DENIED/u,
      `expected PROTECTED_PATH_DENIED: ${describeResult(result)}`,
    );
    assert.equal(existsSync(target), true, '.brudignore must survive the attack');
  });
});

describe('Attack 11 — Traversal and Null Byte', () => {
  it('rejects a parent-traversal read of /etc/passwd', async () => {
    const result = await execute('read_file', { filePath: '../../etc/passwd' });
    const rendered = describeResult(result);

    assert.equal(result.status, 'failed', `traversal read succeeded: ${rendered}`);
    assert.match(rendered, /WORKSPACE_PATH_VIOLATION|VALIDATION_ERROR/u, rendered);
    assert.doesNotMatch(rendered, /root:x:0:0/u, 'host passwd content leaked');
  });

  it('rejects a NUL-byte filename', async () => {
    const result = await execute('read_file', { filePath: '.env\0.txt' });
    const rendered = describeResult(result);

    assert.equal(result.status, 'failed', `NUL-byte read succeeded: ${rendered}`);
    assert.match(rendered, /WORKSPACE_PATH_VIOLATION|VALIDATION_ERROR/u, rendered);
  });

  it('rejects traversal and NUL bytes through mutation tools too', async () => {
    const traversal = await execute('create_file', {
      path: '../escaped.txt',
      content: 'escape\n',
    });
    const nul = await execute('create_file', {
      path: '.env\0.txt',
      content: 'nul\n',
    });

    assert.notEqual(traversal.status, 'success', describeResult(traversal));
    assert.match(describeResult(traversal), /WORKSPACE_PATH_VIOLATION|VALIDATION_ERROR/u);
    assert.notEqual(nul.status, 'success', describeResult(nul));
    assert.match(describeResult(nul), /WORKSPACE_PATH_VIOLATION|VALIDATION_ERROR/u);
    assert.equal(existsSync(join(daemon.workspaceRoot, '..', 'escaped.txt')), false);
  });
});