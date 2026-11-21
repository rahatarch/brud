import { createInterface } from 'node:readline';
import { flagOn, flagText, type ParsedArgs } from '../../core/args.js';
import { resolveConfigPath } from '../../composition/load.js';
import { describeError } from '../../core/errors.js';
import type { Io } from '../../core/io.js';
import { openSession, SESSION_FLAGS } from '../../composition/session.js';
import type { Style } from '../../core/report.js';

export const RUN_FLAGS = SESSION_FLAGS;

const END_MARK = '[/BRUD]';

/**
 * `brud run [config]`: boots the composition (or, with `--daemon`, starts the
 * daemon and boots it there), then routes each Brud document read from stdin.
 * A document ends at a `[/BRUD]` line. It stops at end of input or Ctrl+C.
 */
export async function runRun(io: Io, style: Style, args: ParsedArgs): Promise<number> {
  const configPath = resolveConfigPath(io.cwd, args.positionals[0] ?? flagText(args, 'config'));
  const session = await openSession(io, args, configPath, flagOn(args, 'daemon'));
  let failures = 0;

  try {
    const kinds = await session.kinds();

    io.err(`${session.description}\nkinds: ${kinds.length === 0 ? '(none)' : kinds.map((kind) => kind.kind).join(', ')}\nsend Brud text on stdin, ending each document with ${END_MARK}; Ctrl+C to stop\n`);

    const lines = createInterface({ input: io.stdin, terminal: false });
    const stop = (): void => {
      lines.close();
    };

    process.once('SIGINT', stop);

    let document: string[] = [];

    for await (const line of lines) {
      document.push(line);

      if (line.trim() !== END_MARK) {
        continue;
      }

      try {
        const result = await session.route(document.join('\n'));

        failures += result.status === 'success' ? 0 : 1;
        io.out(`${JSON.stringify(result, null, style.json ? 0 : 2)}\n`);
      } catch (error: unknown) {
        failures += 1;
        io.err(`route failed: ${describeError(error).message}\n`);
      }

      document = [];
    }

    process.removeListener('SIGINT', stop);
  } finally {
    await session.close();
  }

  return failures === 0 ? 0 : 1;
}
