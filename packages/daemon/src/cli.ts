#!/usr/bin/env node
import { createDaemon } from './server/createDaemon.js';
import type { RunningDaemon } from './server/createDaemon.js';

interface CliOptions {
  readonly workspaceRoot: string;
  readonly idleTimeoutMs: number | undefined;
  readonly foreground: boolean;
}

const KNOWN_FLAGS = new Set(['--workspace', '--idle-ms', '--foreground']);

function readArgument(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);

  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];
  return value === undefined || value.length === 0 || value.startsWith('--') ? undefined : value;
}

function parseIdleTimeout(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --idle-ms value "${raw}"`);
  }

  return parsed;
}

function assertKnownFlags(argv: readonly string[]): void {
  for (const argument of argv) {
    if (argument.startsWith('--') && !KNOWN_FLAGS.has(argument)) {
      throw new Error(`Unknown daemon option "${argument}"`);
    }
  }
}

function parseOptions(argv: readonly string[]): CliOptions {
  assertKnownFlags(argv);

  const workspaceRoot = readArgument(argv, '--workspace')
    ?? process.env.BRUD_DAEMON_WORKSPACE
    ?? process.cwd();

  return {
    workspaceRoot,
    idleTimeoutMs: parseIdleTimeout(readArgument(argv, '--idle-ms')),
    foreground: argv.includes('--foreground'),
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  if (!options.foreground) {
    process.stdout.write('brud-daemon runs in the foreground; pass --foreground to silence this notice\n');
  }

  const daemon: RunningDaemon = await createDaemon({
    workspaceRoot: options.workspaceRoot,
    ...(options.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: options.idleTimeoutMs }),
  });

  process.stdout.write(
    `brud-daemon listening on ${daemon.endpoint.socketPath} (workspace: ${daemon.endpoint.workspaceRoot})\n`,
  );

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
