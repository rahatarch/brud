import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { flagOn, flagText, UsageError, type ParsedArgs } from '../args.js';
import { resolveConfigPath } from '../composition.js';
import type { Io } from '../io.js';
import { openSession, SESSION_FLAGS } from '../session.js';
import type { Style } from '../report.js';

export const CALL_FLAGS = { ...SESSION_FLAGS, value: [...SESSION_FLAGS.value, 'file'] } as const;

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }

  return Buffer.concat(chunks).toString('utf8');
}

/**
 * `brud call <text>`: boots the composition (in-process, or through the daemon
 * with `--daemon`), sends one Brud document, prints the route result and exits.
 * `<text>` may be `-` for stdin, or use `--file <path>`. Exit 1 when the route
 * does not succeed.
 */
export async function runCall(io: Io, style: Style, args: ParsedArgs): Promise<number> {
  const file = flagText(args, 'file');
  const given = args.positionals[0];

  if (file === undefined && given === undefined) {
    throw new UsageError('brud call needs Brud text: `brud call "<text>"`, `brud call -` (stdin) or `--file <path>`');
  }

  const text = file === undefined ? (given === '-' ? await readAll(io.stdin) : (given as string)) : readFileSync(resolve(io.cwd, file), 'utf8');
  const configPath = resolveConfigPath(io.cwd, flagText(args, 'config'));
  const session = await openSession(io, args, configPath, flagOn(args, 'daemon'));

  try {
    const result = await session.route(text);

    io.out(`${JSON.stringify(result, null, style.json ? 0 : 2)}\n`);

    return result.status === 'success' ? 0 : 1;
  } finally {
    await session.close();
  }
}
