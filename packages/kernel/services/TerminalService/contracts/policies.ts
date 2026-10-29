/**
 * Frozen execution policy of `brud.core.terminal`.
 *
 * The policy is ingested once from the boot settings snapshot and never
 * subscribed to, so an in-flight session cannot observe a limit change between
 * admission and spawn.
 */
export interface TerminalPolicy {
  /** Default per-command timeout when a request omits one. */
  readonly defaultTimeoutMs: number;

  /** Ceiling applied to any requested timeout. */
  readonly maxTimeoutMs: number;

  /** Grace period between `SIGTERM` and the forced process-group kill. */
  readonly killGraceMs: number;

  /** Hard ceiling on the bytes retained for one session (stdout + stderr). */
  readonly maxOutputBytes: number;

  /** Sessions that may execute concurrently before requests are refused. */
  readonly concurrency: number;

  /** Commands a single batch request may carry. */
  readonly maxBatchCommands: number;

  /**
   * Host environment variables inherited by every child.
   *
   * Nothing outside this list is inherited; a request may admit additional
   * keys explicitly, subject to the denylist.
   */
  readonly environmentAllowList: readonly string[];

  /**
   * Request-supplied keys that are never admitted.
   *
   * These load code into the child before the command runs (`LD_PRELOAD`,
   * `NODE_OPTIONS`, `BASH_ENV`, ...) or would silently widen inheritance
   * (`PATH`, `HOME`).
   */
  readonly environmentDenyList: readonly string[];

  /**
   * Whether the host persists session pids so a boot-time orphan sweep can
   * reap children a previous host crashed without terminating.
   *
   * This is an *active* policy input, not informational: it is read at
   * admission to decide whether the session ledger records a pid for the
   * sweep. The service cannot itself scan a previous process tree, so the
   * sweep runs in the host composition (the daemon launcher), which reads this
   * flag from {@link TerminalPolicy}. The default is `false`: nothing is
   * persisted, and the host termination handlers installed in
   * {@link TerminalService.initialize} remain the only reaping rail.
   */
  readonly reapOrphansAtBoot: boolean;

  readonly schemaVersion: 1;
}

/** Environment inherited by children unless the policy narrows it further. */
export const DEFAULT_ENVIRONMENT_ALLOW_LIST: readonly string[] = Object.freeze([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SYSTEMROOT',
  'COMSPEC',
  'PATHEXT',
  'WINDIR',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'OS',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
]);

/**
 * Keys a request may never override.
 *
 * The denylist applies to *request-supplied* keys only: `PATH`, `HOME` and
 * `SHELL` are inherited from the allowlist because a child without them
 * cannot resolve its own shell, but a caller must not redirect them. The
 * remaining keys load code into the child before the command runs.
 */
export const DEFAULT_ENVIRONMENT_DENY_LIST: readonly string[] = Object.freeze([
  'PATH',
  'HOME',
  'SHELL',
  'IFS',
  'ENV',
  'BASH_ENV',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'NODE_OPTIONS',
  'PYTHONSTARTUP',
  'PYTHONPATH',
  'PERL5OPT',
  'RUBYOPT',
  'GCONV_PATH',
  'PROMPT_COMMAND',
  'JAVA_TOOL_OPTIONS',
  '_JAVA_OPTIONS',
]);

/** Default retention ceiling: 8 MiB, matching the read governor. */
export const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

/** Default per-command timeout. */
export const DEFAULT_TERMINAL_TIMEOUT_MS = 120_000;

/** Default ceiling for a requested timeout. */
export const MAX_TERMINAL_TIMEOUT_MS = 60 * 60 * 1000;

/** Default grace period before a forced kill. */
export const DEFAULT_TERMINAL_KILL_GRACE_MS = 5_000;

/** Default concurrent session ceiling. */
export const DEFAULT_TERMINAL_CONCURRENCY = 8;

/** Default command ceiling for one batch request. */
export const DEFAULT_TERMINAL_MAX_BATCH_COMMANDS = 100;

/** The policy a standalone instance starts with. */
export const DEFAULT_TERMINAL_POLICY: TerminalPolicy = Object.freeze({
  defaultTimeoutMs: DEFAULT_TERMINAL_TIMEOUT_MS,
  maxTimeoutMs: MAX_TERMINAL_TIMEOUT_MS,
  killGraceMs: DEFAULT_TERMINAL_KILL_GRACE_MS,
  maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
  concurrency: DEFAULT_TERMINAL_CONCURRENCY,
  maxBatchCommands: DEFAULT_TERMINAL_MAX_BATCH_COMMANDS,
  environmentAllowList: DEFAULT_ENVIRONMENT_ALLOW_LIST,
  environmentDenyList: DEFAULT_ENVIRONMENT_DENY_LIST,
  reapOrphansAtBoot: false,
  schemaVersion: 1,
});
