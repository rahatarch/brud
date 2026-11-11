/**
 * Test-support child process for peer-credential verification.
 *
 * It is a real process with its own PID. The daemon must refuse it because it
 * is not the process that spawned the daemon, even though it runs as the same
 * user. Nothing is mocked: the child opens a real Unix socket.
 */
import { createConnection } from 'node:net';
import * as Protocol from '@brud/protocol';
import { DaemonClient } from '../../client/DaemonClient.js';
import { connectSocket } from '../../client/socket.js';
import { channelPrologue } from '../../security/channel.js';

function fail(message: string): never {
  process.stdout.write(`ERROR:${message}\n`);
  process.exit(2);
}

const [mode, socketPath, workspaceRoot, token] = process.argv.slice(2);

if (mode !== 'raw' && mode !== 'client') {
  fail(`unknown probe mode "${String(mode)}"`);
}

if (
  socketPath === undefined
  || workspaceRoot === undefined
  || token === undefined
) {
  fail('missing probe arguments');
}

async function run(): Promise<void> {
  if (mode === 'raw') {
    let received = '';

    const socket = createConnection(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      process.stdout.write(`DATA:${JSON.stringify(received)}\n`);
      process.exit(0);
    }, 10_000);
    timer.unref?.();

    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      received += chunk;
    });
    socket.on('error', () => undefined);
    socket.on('close', () => {
      clearTimeout(timer);
      process.stdout.write(`DATA:${JSON.stringify(received)}\n`);
      process.exit(0);
    });
    return;
  }

  const socket = await connectSocket(socketPath);
  const client = new DaemonClient(socket, {
    psk: token,
    principal: 'ui',
    workspaceRoot,
    prologue: channelPrologue(socketPath),
  });

  try {
    await client.connect({
      protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
      clientInfo: { name: 'brud-peer-probe', version: '0.0.1' },
    });
    process.stdout.write('CONNECTED\n');
  } catch (error: unknown) {
    process.stdout.write(
      `REFUSED:${error instanceof Error ? error.message : String(error)}\n`,
    );
  } finally {
    await client.close().catch(() => undefined);
  }
}

void run().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});