#!/usr/bin/env node
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createDaemon } from './server/createDaemon.js';
import type { RunningDaemon } from './server/createDaemon.js';

interface CliOptions {
  readonly home: string;
  readonly operatorConfigPath: string | undefined;
  readonly idleTimeoutMs: number | undefined;
  readonly instanceIdleTimeoutMs: number | undefined;
  readonly foreground: boolean;
}

const KNOWN_FLAGS = new Set(['--home', '--config', '--idle-ms', '--instance-idle-ms', '--foreground']);

/** Default daemon home when neither `--home` nor `BRUD_DAEMON_HOME` is set. */
export const DEFAULT_DAEMON_HOME = join(homedir(), '.brud');

function readArgument(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);

  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];

  return value === undefined || value.length === 0 || value.startsWith('--') ? undefined : value;
}

function parseTimeout(raw: string | undefined, flag: string): number | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${flag} value "${raw}"`);
  }

  return parsed;
}

function parseOptions(argv: readonly string[]): CliOptions {
  for (const argument of argv) {
    if (argument.startsWith('--') && !KNOWN_FLAGS.has(argument)) {
      throw new Error(`Unknown daemon option "${argument}"`);
    }
  }

  return {
    home: readArgument(argv, '--home') ?? process.env.BRUD_DAEMON_HOME ?? DEFAULT_DAEMON_HOME,
    operatorConfigPath: readArgument(argv, '--config') ?? process.env.BRUD_DAEMON_CONFIG,
    idleTimeoutMs: parseTimeout(readArgument(argv, '--idle-ms'), '--idle-ms'),
    instanceIdleTimeoutMs: parseTimeout(readArgument(argv, '--instance-idle-ms'), '--instance-idle-ms'),
    foreground: argv.includes('--foreground'),
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  // The host that spawned this process is the only socket peer admitted.
  const expectedPeerPid = process.ppid;
  const options = parseOptions(process.argv.slice(2));

  if (!options.foreground) {
    process.stdout.write('brud-daemon runs in the foreground; pass --foreground to silence this notice\n');
  }

  const daemon: RunningDaemon = await createDaemon({
    home: options.home,
    ...(options.operatorConfigPath === undefined ? {} : { operatorConfigPath: options.operatorConfigPath }),
    ...(options.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: options.idleTimeoutMs }),
    ...(options.instanceIdleTimeoutMs === undefined ? {} : { instanceIdleTimeoutMs: options.instanceIdleTimeoutMs }),
    expectedPeerPid,
  });

  process.stdout.write(`brud-daemon listening on ${daemon.endpoint.socketPath} (home: ${daemon.endpoint.home})\n`);

  let terminating = false;
  const terminate = async (signal: NodeJS.Signals): Promise<void> => {
    if (terminating) {
      return;
    }

    terminating = true;

    try {
      await daemon.shutdown();
      process.stdout.write(`brud-daemon stopped (${signal})\n`);
      process.exit(0);
    } catch (error: unknown) {
      process.stderr.write(`brud-daemon shutdown failed: ${describeError(error)}\n`);
      process.exit(1);
    }
  };

  process.once('SIGINT', () => {
    void terminate('SIGINT');
  });
  process.once('SIGTERM', () => {
    void terminate('SIGTERM');
  });
}

void main().catch((error: unknown) => {
  process.stderr.write(`brud-daemon failed: ${describeError(error)}\n`);
  process.exitCode = 1;
});
