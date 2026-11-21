import { parseArgs, UsageError, type FlagSpec, type ParsedArgs } from './args.js';
import { CommandError, describeError } from './errors.js';
import type { Io } from './io.js';
import { readOwnPackage } from './project.js';
import { styleFrom, type Style } from './report.js';
import { ADD_FLAGS, runAdd } from './commands/add.js';
import { CALL_FLAGS, runCall } from './commands/call.js';
import { CHECK_FLAGS, runCheck } from './commands/check.js';
import { DOCTOR_FLAGS, runDoctor } from './commands/doctor.js';
import { INIT_FLAGS, runInit } from './commands/init.js';
import { INSPECT_FLAGS, runInspect } from './commands/inspect.js';
import { PACK_FLAGS, runPack } from './commands/pack.js';
import { RUN_FLAGS, runRun } from './commands/run.js';

interface Command {
  readonly summary: string;
  readonly usage: string;
  readonly flags: FlagSpec;
  readonly run: (io: Io, style: Style, args: ParsedArgs) => Promise<number>;
}

const COMMANDS: Readonly<Record<string, Command>> = {
  doctor: { summary: 'Check this machine, the composition and the daemon (read-only)', usage: 'brud doctor [config] [--option key=value]', flags: DOCTOR_FLAGS, run: runDoctor },
  init: { summary: 'Scaffold a project that passes doctor and npm test', usage: 'brud init [name] [--kind] [--guest] [--no-install]', flags: INIT_FLAGS, run: runInit },
  check: { summary: 'Boot the composition in a scratch state and report problems', usage: 'brud check [config] [--option key=value]', flags: CHECK_FLAGS, run: runCheck },
  run: { summary: 'Boot a kernel (or the daemon) and route Brud text from stdin', usage: 'brud run [config] [--daemon] [--state dir] [--cap c] [--tier ui|ai]', flags: RUN_FLAGS, run: runRun },
  call: { summary: 'Send one Brud document and print the route result', usage: 'brud call <text|-> [--file path] [--config path] [--daemon] [--tier ui|ai] [--cap c]', flags: CALL_FLAGS, run: runCall },
  kinds: { summary: 'List the kinds and operations a composition owns', usage: 'brud kinds [config]', flags: INSPECT_FLAGS, run: (io, style, args) => runInspect(io, style, args, 'kinds') },
  inspect: { summary: 'List participants, kinds, exposures, requirements and who can resolve each', usage: 'brud inspect [config] [--cap c]', flags: INSPECT_FLAGS, run: (io, style, args) => runInspect(io, style, args, 'all') },
  add: { summary: 'Add a Brud participant package (inspected before it is installed)', usage: 'brud add <name[@version] | ./file.tgz | ./folder> [--dry-run] [--write] [--allow-scripts] [--config path]', flags: ADD_FLAGS, run: runAdd },
  pack: { summary: 'Build a caged participant package (experimental)', usage: 'brud pack [dir] [--out dir] [--verify]', flags: PACK_FLAGS, run: runPack },
};

/** Exit codes, documented in `brud --help`. */
export const EXIT = { ok: 0, failure: 1, usage: 2 } as const;

function helpText(): string {
  const width = Math.max(...Object.keys(COMMANDS).map((name) => name.length));
  const rows = Object.entries(COMMANDS).map(([name, command]) => `  ${name.padEnd(width)}  ${command.summary}`);

  return `brud ${readOwnPackage().version} - set up, check, run, call and package BrudOS participants\n\nUsage: brud <command> [options]\n\nCommands:\n${rows.join('\n')}\n\nGlobal options:\n  --json        machine-readable output\n  --home <dir>  daemon home (default: $BRUD_DAEMON_HOME or ~/.brud)\n  --no-color    plain output\n  --help        show help (also \`brud <command> --help\`)\n  --version     show the version\n\nExit codes: 0 success, 1 a problem was found or the command failed, 2 the command line was wrong.\n`;
}

/**
 * Runs one `brud` invocation and returns its exit code. Nothing here exits the
 * process, so tests drive it directly.
 */
export async function main(argv: readonly string[], io: Io): Promise<number> {
  const [name, ...rest] = argv;

  if (name === undefined || name === '--help' || name === '-h' || name === 'help') {
    io.out(helpText());

    return EXIT.ok;
  }

  if (name === '--version' || name === '-v') {
    io.out(`${readOwnPackage().version}\n`);

    return EXIT.ok;
  }

  const command = COMMANDS[name];

  if (command === undefined) {
    io.err(`brud: unknown command "${name}"\n\n${helpText()}`);

    return EXIT.usage;
  }

  try {
    const args = parseArgs(rest, command.flags);

    if (args.flags.get('help') === true) {
      io.out(`${command.usage}\n\n${command.summary}\n`);

      return EXIT.ok;
    }

    return await command.run(io, styleFrom(io, args.flags), args);
  } catch (error: unknown) {
    if (error instanceof UsageError) {
      io.err(`brud ${name}: ${error.message}\nusage: ${command.usage}\n`);

      return EXIT.usage;
    }

    const { code, message } = describeError(error);

    io.err(`brud ${name}: ${error instanceof CommandError || code !== undefined ? `${code ?? ''} ${message}`.trim() : message}\n`);

    return EXIT.failure;
  }
}
