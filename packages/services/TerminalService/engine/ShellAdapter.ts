import type { TerminalErrorCode } from '../contracts/errors.js';
import type { TerminalPolicy } from '../contracts/policies.js';

/** Host platform a spawn strategy targets. */
export type TerminalPlatform = 'win32' | 'posix';

/** Concrete shell invocation for one command. */
export interface ShellInvocation {
  /** Executable handed to `spawn`. */
  readonly file: string;
  /** Argument vector handed to `spawn`. */
  readonly args: readonly string[];
  /** Whether the file is a shell that already carries the command in `args`. */
  readonly usesShell: boolean;
}

/** Outcome of environment sanitation. */
export type EnvironmentOutcome =
  | { readonly ok: true; readonly env: Readonly<Record<string, string>> }
  | {
      readonly ok: false;
      readonly code: TerminalErrorCode;
      readonly message: string;
      readonly keys: readonly string[];
    };

/**
 * Keys whose presence in the request environment is a rejection, not a
 * silent drop: admitting a caller that tries to set one would be a policy
 * violation the caller must see.
 */
const REJECT_PREFIXES: readonly string[] = Object.freeze([
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'NPM_TOKEN',
  'SSH_AUTH_SOCK',
]);

/**
 * Extension-runtime secrets that are stripped from the inherited host
 * environment even when a deployment lists them in its allow list.
 */
const SECRET_PREFIXES: readonly string[] = Object.freeze([
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'AWS_',
  'NPM_TOKEN',
  'VSCODE_',
  'SSH_AUTH_SOCK',
  'BRUD_',
]);

/** Environment variable name syntax accepted from a request. */
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Platform shell strategy and environment gate.
 *
 * The adapter owns every platform-specific decision — how a command string is
 * handed to a shell, how the tree is killed, which keys reach the child — so
 * the process manager stays free of `process.platform` branches.
 */
export class ShellAdapter {
  private readonly platform: TerminalPlatform;

  /**
   * @param platform - Host platform. Defaults to the running platform.
   */
  constructor(platform?: TerminalPlatform) {
    this.platform = platform ?? (process.platform === 'win32' ? 'win32' : 'posix');
  }

  /** Platform this adapter targets. */
  get target(): TerminalPlatform {
    return this.platform;
  }

  /** Whether a child becomes a process-group leader on this platform. */
  get detached(): boolean {
    return this.platform === 'posix';
  }

  /** Shell executable used when the command string is written to stdin. */
  shellFile(): string {
    return this.platform === 'win32'
      ? (process.env.COMSPEC ?? 'cmd.exe')
      : (process.env.SHELL ?? '/bin/sh');
  }

  /**
   * Builds the spawn invocation for a command string.
   *
   * On POSIX the shell reads the script from stdin (`-s`) instead of argv
   * (`-c`) so the command text never appears in the process table and stdin
   * stays available for the piped answer stream. On Windows the command is
   * passed through `cmd.exe /c`.
   *
   * @param command - Command text.
   */
  build(command: string): ShellInvocation {
    if (this.platform === 'win32') {
      return {
        file: this.shellFile(),
        args: ['/d', '/s', '/c', command],
        usesShell: true,
      };
    }

    return {
      file: this.shellFile(),
      args: ['-s'],
      usesShell: true,
    };
  }

  /**
   * Builds the script written to the shell's stdin.
   *
   * The command is written to stdin rather than passed as an argument so a
   * multi-command string (`a && b`, `cd x; y`) runs in one shell and the exit
   * status is the last command's.
   *
   * @param command - Command text.
   */
  scriptFor(command: string): string {
    return `${command}\n`;
  }

  /**
   * Builds the sanitized child environment.
   *
   * Inheritance is allowlist-first: only keys the policy lists are copied
   * from the host, and only when they are not secrets. Request-supplied keys
   * are admitted only if they are syntactically valid, not denylisted, not a
   * secret, and not a rejection target.
   *
   * @param policy - Frozen terminal policy.
   * @param requested - Caller-supplied environment.
   * @param host - Host environment. Defaults to `process.env`.
   */
  buildEnvironment(
    policy: TerminalPolicy,
    requested?: Readonly<Record<string, string>>,
    host: Readonly<Record<string, string | undefined>> = process.env,
  ): EnvironmentOutcome {
    const env: Record<string, string> = {};
    const allowList = new Set(policy.environmentAllowList.map((key) => key.toUpperCase()));

    for (const [key, value] of Object.entries(host)) {
      if (value === undefined) {
        continue;
      }

      // Inheritance is allowlist-first and secret-free. The request denylist
      // deliberately does not apply here: a child without `PATH`/`HOME`/`SHELL`
      // cannot resolve its own shell, so those are inherited but cannot be
      // overridden by a request.
      if (!allowList.has(key.toUpperCase()) || isSecret(key)) {
        continue;
      }

      env[key] = value;
    }

    if (!requested) {
      return { ok: true, env: Object.freeze(env) };
    }

    const rejected: string[] = [];

    for (const [key, value] of Object.entries(requested)) {
      if (typeof value !== 'string' || !ENV_KEY_PATTERN.test(key)) {
        rejected.push(key);

        continue;
      }

      if (isRejected(key)) {
        rejected.push(key);

        continue;
      }

      if (isSecret(key) || isDenied(policy, key)) {
        // A denylisted key is dropped rather than rejected: the request may
        // legitimately keep its defaults and only the override is unsafe.
        continue;
      }

      env[key] = value;
    }

    if (rejected.length > 0) {
      return {
        ok: false,
        code: 'TERMINAL_INVALID_REQUEST',
        message: `Environment keys ${rejected.join(', ')} may not be set by a terminal request.`,
        keys: rejected,
      };
    }

    return { ok: true, env: Object.freeze(env) };
  }

  /** Arguments that kill an entire process tree on this platform. */
  treeKillArgs(pid: number): readonly string[] {
    return ['/F', '/T', '/PID', String(pid)];
  }

  /** Whether tree killing needs an external `taskkill` helper. */
  get needsTaskkill(): boolean {
    return this.platform === 'win32';
  }

  /** External helper that kills a tree on this platform, when one is required. */
  treeKillHelper(): string {
    return 'taskkill';
  }
}

/**
 * Reports whether a key names an extension secret.
 *
 * @param key - Environment key.
 */
function isSecret(key: string): boolean {
  const upper = key.toUpperCase();

  return SECRET_PREFIXES.some((prefix) => upper.startsWith(prefix));
}

/**
 * Reports whether a request may not set a key at all.
 *
 * @param key - Environment key.
 */
function isRejected(key: string): boolean {
  const upper = key.toUpperCase();

  return REJECT_PREFIXES.some((prefix) => upper.startsWith(prefix));
}

/**
 * Reports whether the policy denylist names a key.
 *
 * @param policy - Frozen policy.
 * @param key - Environment key.
 */
function isDenied(policy: TerminalPolicy, key: string): boolean {
  const upper = key.toUpperCase();

  return policy.environmentDenyList.some((denied) => denied.toUpperCase() === upper);
}
