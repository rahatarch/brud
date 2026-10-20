#!/usr/bin/env node
import { startHttpServer } from './http';
import { startStdioServer } from './server';

const WORKSPACE_ENV = 'BRUD_MCP_WORKSPACE';
const DEFAULT_EXECUTION_TIMEOUT_MS = 120_000;

function readFlag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flagValues = new Set(['--port', '--path', '--timeout']);
  const positional = args.filter((arg, index) => {
    if (index > 0 && flagValues.has(args[index - 1])) {
      return false;
    }
    return !arg.startsWith('--');
  });
  const candidate = positional[0] ?? process.env[WORKSPACE_ENV];
  if (!candidate) {
    process.stderr.write(
      `Brud MCP server: no workspace supplied. Pass it as the first argument or set ${WORKSPACE_ENV}.\n`,
    );
    process.exit(2);
  }

  const timeoutFlag = readFlag(args, '--timeout');
  const timeoutSeconds = timeoutFlag === undefined ? undefined : Number(timeoutFlag);
  if (timeoutSeconds !== undefined && (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0)) {
    process.stderr.write(`Brud MCP server: invalid --timeout value: ${timeoutFlag}\n`);
    process.exit(2);
  }
  const executionTimeoutMs =
    timeoutSeconds === undefined ? DEFAULT_EXECUTION_TIMEOUT_MS : Math.round(timeoutSeconds * 1000);

  try {
    if (args.includes('--http')) {
      const portFlag = readFlag(args, '--port');
      const pathFlag = readFlag(args, '--path');
      const port = portFlag === undefined ? undefined : Number(portFlag);
      if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
        throw new Error(`Invalid --port value: ${portFlag}`);
      }
      const server = await startHttpServer(candidate, {
        port,
        path: pathFlag,
        executionTimeoutMs,
      });
      process.stderr.write(`Brud MCP server listening on ${server.url}\n`);
      const shutdown = () => {
        void server.close().finally(() => process.exit(0));
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
      return;
    }

    await startStdioServer(candidate, undefined, { executionTimeoutMs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Brud MCP server failed to start: ${message}\n`);
    process.exit(1);
  }
}

void main();
