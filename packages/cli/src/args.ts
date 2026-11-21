/** A command line the CLI cannot act on (exit code 2). */
export class UsageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/** Flags one command accepts, beyond the global ones. */
export interface FlagSpec {
  readonly boolean?: readonly string[];
  readonly value?: readonly string[];
  /** Value flags that may be given more than once. */
  readonly repeat?: readonly string[];
}

/** Flags every command accepts. */
export const GLOBAL_FLAGS: FlagSpec = {
  boolean: ['json', 'no-color', 'help'],
  value: ['home'],
};

export interface ParsedArgs {
  readonly positionals: readonly string[];
  readonly flags: ReadonlyMap<string, string | true>;
  readonly lists: ReadonlyMap<string, readonly string[]>;
}

/**
 * Parses `argv` against a flag spec. `--flag value` and `--flag=value` both
 * work; an unknown flag is a usage error rather than being ignored.
 */
export function parseArgs(argv: readonly string[], spec: FlagSpec = {}): ParsedArgs {
  const booleans = new Set([...(GLOBAL_FLAGS.boolean ?? []), ...(spec.boolean ?? [])]);
  const repeats = new Set(spec.repeat ?? []);
  const values = new Set([...(GLOBAL_FLAGS.value ?? []), ...(spec.value ?? []), ...repeats]);
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  const lists = new Map<string, string[]>();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;

    if (!argument.startsWith('--')) {
      positionals.push(argument);
      continue;
    }

    const equals = argument.indexOf('=');
    const name = argument.slice(2, equals === -1 ? undefined : equals);

    if (booleans.has(name)) {
      if (equals !== -1) {
        throw new UsageError(`--${name} does not take a value`);
      }

      flags.set(name, true);
      continue;
    }

    if (!values.has(name)) {
      throw new UsageError(`Unknown option "--${name}"`);
    }

    const value = equals === -1 ? argv[(index += 1)] : argument.slice(equals + 1);

    if (value === undefined || value.length === 0 || (equals === -1 && value.startsWith('--'))) {
      throw new UsageError(`--${name} needs a value`);
    }

    if (repeats.has(name)) {
      lists.set(name, [...(lists.get(name) ?? []), value]);
    } else {
      flags.set(name, value);
    }
  }

  return { positionals, flags, lists };
}

/** A value flag's text, when given. */
export function flagText(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);

  return typeof value === 'string' ? value : undefined;
}

/** Whether a boolean flag was given. */
export function flagOn(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) === true;
}
