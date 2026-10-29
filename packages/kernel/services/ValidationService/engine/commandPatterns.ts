import type { CommandRule } from '../contracts/rules.js';

/**
 * Dangerous-command pattern catalog.
 *
 * `LEGACY_PATTERNS` is a byte-for-byte copy of
 * `packages/core/src/api/index.ts:105-123`. It is kept verbatim so the legacy
 * `validation/terminal.test.ts` gate stays green; the facade runs it first and
 * reports the first match exactly as the old implementation did.
 *
 * `HARDENED_PATTERNS` closes the nine exploitable bypasses catalogued in
 * audit §3.6. They are additive: nothing that was blocked before is allowed
 * now, and the pattern index a legacy caller observes is unchanged because
 * the hardened set is only consulted after the legacy set misses.
 */

/** One dangerous-command family. */
export interface CommandPattern {
  /** Rule id emitted when the pattern matches. */
  readonly rule: CommandRule;
  /** Pattern applied to the normalized command text. */
  readonly pattern: RegExp;
  /** Short human description used in decision metadata. */
  readonly description: string;
}

/** The 17 legacy regexes, in their original order. */
export const LEGACY_PATTERNS: readonly RegExp[] = Object.freeze([
  /\brm\s+-(?:rf|fr)\s+(\/|\/\*|~|\.)(?:$|\s)/,
  /\brm\s+-(?:rf|fr)\s+\*\s*$/,
  /\bsudo\b/,
  /\bsu\b/,
  /\bpkexec\b/,
  /\bmkfs\b/,
  /\bfdisk\b/,
  /\bdd\s+if=/,
  /curl\s+.*\|\s*(bash|sh)\b/,
  /wget\s+.*\|\s*(bash|sh)\b/,
  /\bchmod\s+-R\s+777\b/,
  /\bchown\s+-R\b/,
  />\s+\/dev\/sd/,
  />\s+\/dev\/nvme/,
  /:\s*\(\)\s*\{[^}]*:\s*:\s*\(\)\s*\|/,
  /\bapt-get\s+--force-yes\b/,
  /\bnpm\s+--unsafe-perm\b/,
] satisfies readonly RegExp[]);

/** Rule ids paired with the legacy pattern array, by index. */
export const LEGACY_PATTERN_RULES: readonly CommandRule[] = Object.freeze([
  'CMD.RM_ROOT',
  'CMD.RM_GLOB',
  'CMD.PRIVILEGE',
  'CMD.PRIVILEGE',
  'CMD.PRIVILEGE',
  'CMD.DISK',
  'CMD.DISK',
  'CMD.DISK',
  'CMD.PIPE_SHELL',
  'CMD.PIPE_SHELL',
  'CMD.PERMISSION_WIDEN',
  'CMD.PERMISSION_WIDEN',
  'CMD.DEVICE_REDIRECT',
  'CMD.DEVICE_REDIRECT',
  'CMD.FORK_BOMB',
  'CMD.FORCED_PKG',
  'CMD.FORCED_PKG',
] satisfies readonly CommandRule[]);

export interface CommandScanMatch {
  /** Rule violated. */
  readonly rule: CommandRule;
  /** Index in the legacy pattern array, when the match came from it. */
  readonly legacyIndex?: number;
  /** Short description of the family that matched. */
  readonly description: string;
}

/** Discretionary prefixes that wrap the real command. */
const WRAPPER_PREFIX_PATTERN =
  /^(?:[A-Za-z_][A-Za-z0-9_]*=.*?\s+)*(?:(?:sudo|doas|env|nice|nohup|setsid|timeout|command|builtin|exec|stdbuf|xargs)\b(?:\s+-\S+|\s+\d[\w.]*)?\s+)+/u;

/** Shell operators that separate independent command segments. */
const SEGMENT_SPLIT_PATTERN = /\s*(?:&&|\|\||;|\|)\s*/u;

/** A flag token, e.g. `-rf`, `-r`, `--recursive`. */
const FLAG_TOKEN_PATTERN = /^--?[A-Za-z][A-Za-z-]*$/u;

/** Recursive flag in short or long form. */
const RECURSIVE_FLAG_PATTERN = /^(?:-[A-Za-z]*[rR][A-Za-z]*|--recursive)$/u;

/** Forced flag in short or long form. */
const FORCED_FLAG_PATTERN = /^(?:-[A-Za-z]*[fF][A-Za-z]*|--force)$/u;

/**
 * Targets that destroy a root, home, or the current directory wholesale.
 *
 * `rm -rf /root` is deliberately **not** matched: only the filesystem root, a
 * root glob, the home directory, and the current directory are.
 */
const DESTRUCTIVE_TARGET_PATTERN = /^(?:\/|\/\*|\/\.|\*|~|~\/\*|\.|\.\/?\*|\.\.?)$/u;

/** `find -exec` trailing tokens, which are not targets. */
const FIND_TRAILING_TOKEN_PATTERN = /^(?:\{\}|\\?;|\+)$/u;

/** Privilege escalation, case-insensitive. */
const PRIVILEGE_PATTERN = /(?:^|[\s;&|(])(?:sudo|pkexec|doas)(?:\s|$)/iu;

/** Shells that execute piped input. */
const SHELL_NAME_PATTERN = /^(?:sudo|bash|sh|zsh|dash|ksh|csh|tcsh|fish|source)$/u;

/** Encoded or transformed payload producers. */
const ENCODED_PRODUCER_PATTERN = /\b(?:base64|base32|xxd|openssl\s+enc)\b/u;

/** Network fetchers. */
const NETWORK_FETCHER_PATTERN = /\b(?:curl|wget|fetch)\b/u;

/** Disk formatting or partitioning tools. */
const DISK_PATTERN = /\b(?:mkfs(?:\.\w+)?|mke2fs|fdisk|sfdisk|parted|wipefs)\b/u;

/** Raw device write through a redirect or a `dd of=` target. */
const DEVICE_WRITE_PATTERN = /(?:>|\bof=)\s*\/dev\/(?:sd[a-z]\d*|hd[a-z]\d*|nvme\d|disk\d|mmcblk\d)/u;

/** Forced package operations. */
const FORCED_PACKAGE_PATTERN =
  /\b(?:apt-get\s+install\b[^;&|]*--force-yes|apt-get\s+install\b[^;&|]*\s-y\b[^;&|]*--force-yes|npm\s+install\b[^;&|]*--unsafe-perm|npm\s+i\b[^;&|]*--unsafe-perm)\b/u;

/**
 * Fork-bomb shape, whitespace-insensitive.
 *
 * `:(){ :|:& };:` and `:(){ :|:& };:` with any spacing both reduce to a
 * function definition whose body re-invokes the function in the background.
 */
const FORK_BOMB_PATTERN = /:\s*\(\)\s*\{[^}]*:[^}]*:[^}]*\}/u;

/**
 * Normalizes command text for the hardened rules.
 *
 * Only quoting and whitespace are normalized; the legacy patterns run against
 * the caller's original text so their case sensitivity is unchanged.
 *
 * @param command - Raw command text.
 */
export function normalizeCommand(command: string): string {
  return command
    .replace(/["']/gu, ' ')
    .replace(/\\\s*\n/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Strips wrapper prefixes and returns the underlying command text.
 *
 * @param segment - One command segment.
 */
export function stripWrapper(segment: string): string {
  let current = segment.trim();

  for (;;) {
    const stripped = current.replace(WRAPPER_PREFIX_PATTERN, '').trim();

    if (stripped === current) {
      return stripped;
    }

    current = stripped;
  }
}

/**
 * Splits command text into segments at shell control operators.
 *
 * `{`, `}`, `(` and `)` are deliberately absent: `{}` is `find -exec`'s
 * placeholder and `()` appear inside a fork bomb.
 *
 * @param command - Command text.
 */
export function splitCommandSegments(command: string): readonly string[] {
  return command
    .split(SEGMENT_SPLIT_PATTERN)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function findLegacyMatch(command: string): CommandScanMatch | null {
  for (const [index, pattern] of LEGACY_PATTERNS.entries()) {
    if (pattern.test(command)) {
      return {
        rule: LEGACY_PATTERN_RULES[index] ?? 'CMD.RM_ROOT',
        legacyIndex: index,
        description: `legacy pattern #${index}`,
      };
    }
  }

  return null;
}

/**
 * Evaluates one `rm` invocation.
 *
 * Returns the rule only when the invocation removes a destructive target with
 * both the recursive and forced flags, in any order and any spelling.
 *
 * @param segment - Normalized segment.
 */
/** Prefixes that only wrap another command. */
const WRAPPER_COMMAND_PATTERN =
  /^(?:sudo|doas|env|nice|nohup|setsid|timeout|command|builtin|exec|stdbuf|xargs)\b/u;

function classifyRm(segment: string): CommandRule | null {
  const wrapped = WRAPPER_COMMAND_PATTERN.test(segment)
    || /(?:^|\s)-exec(?:dir)?\b/u.test(segment);
  const tokens = stripWrapper(segment).split(/\s+/u).filter((token) => token.length > 0);
  const rmIndex = tokens.findIndex((token) => /^(?:\S+\/)?rm$/u.test(token));

  if (rmIndex < 0) {
    return null;
  }

  const flags = tokens.filter((token) => FLAG_TOKEN_PATTERN.test(token));
  const targets = tokens
    .slice(rmIndex + 1)
    .filter((token) => !FLAG_TOKEN_PATTERN.test(token) && !FIND_TRAILING_TOKEN_PATTERN.test(token))
    .map((token) => token.replace(/[;,]+$/u, ''));

  const recursive = flags.some((flag) => RECURSIVE_FLAG_PATTERN.test(flag));
  const forced = flags.some((flag) => FORCED_FLAG_PATTERN.test(flag));

  if (!recursive || !forced) {
    return null;
  }

  // `rm` behind `find -exec`, `xargs`, `env`, `nice`, `timeout`, … is the same
  // destructive removal with its target supplied elsewhere: the wrapper itself
  // is proof enough, so it is treated as a root removal.
  if (rmIndex > 0 || wrapped) {
    return 'CMD.RM_ROOT';
  }

  if (targets.some((target) => DESTRUCTIVE_TARGET_PATTERN.test(target))) {
    return 'CMD.RM_ROOT';
  }

  if (targets.length === 0) {
    return 'CMD.RM_GLOB';
  }

  return null;
}

/**
 * Reports whether a pipeline feeds a shell from an encoded or remote payload.
 *
 * @param command - Normalized command text.
 */
function classifyPipeline(command: string): CommandScanMatch | null {
  const segments = splitCommandSegments(command);

  for (let index = 1; index < segments.length; index += 1) {
    const sink = segments[index] ?? '';
    const sinkWords = sink.split(/\s+/u).filter((word) => SHELL_NAME_PATTERN.test(word));

    if (sinkWords.length === 0) {
      continue;
    }

    const source = segments.slice(0, index).join(' ');
    const encoded = ENCODED_PRODUCER_PATTERN.test(source);
    const remote = NETWORK_FETCHER_PATTERN.test(source);

    if (encoded || remote) {
      return {
        rule: 'CMD.PIPE_SHELL',
        description: encoded
          ? 'encoded payload piped into a shell'
          : 'network response piped into a shell',
      };
    }
  }

  return null;
}

/**
 * Scans one segment with the hardened rules.
 *
 * @param segment - Normalized command segment.
 */
function scanSegment(segment: string): CommandScanMatch | null {
  const rmRule = classifyRm(segment);

  if (rmRule !== null) {
    return { rule: rmRule, description: 'recursive forced removal of a root, home, or glob target' };
  }

  if (FORK_BOMB_PATTERN.test(segment)) {
    return { rule: 'CMD.FORK_BOMB', description: 'fork bomb' };
  }

  if (PRIVILEGE_PATTERN.test(segment)) {
    return { rule: 'CMD.PRIVILEGE', description: 'privilege escalation' };
  }

  const chmodTokens = segment.split(/\s+/u);
  const chmodIndex = chmodTokens.findIndex((token) => token === 'chmod');

  if (chmodIndex >= 0) {
    const rest = chmodTokens.slice(chmodIndex + 1);
    const recursive = rest.some((token) => /^-[A-Za-z]*R[A-Za-z]*$/u.test(token) || token === '--recursive');
    const worldWritable = rest.some((token) => token === '777' || token === '0777' || token === '0o777');

    if (recursive && worldWritable) {
      return { rule: 'CMD.PERMISSION_WIDEN', description: 'recursive world-writable permission change' };
    }
  }

  if (DEVICE_WRITE_PATTERN.test(segment)) {
    return { rule: 'CMD.DEVICE_REDIRECT', description: 'raw device write' };
  }

  if (DISK_PATTERN.test(stripWrapper(segment))) {
    return { rule: 'CMD.DISK', description: 'disk formatting or partitioning tool' };
  }

  if (FORCED_PACKAGE_PATTERN.test(segment)) {
    return { rule: 'CMD.FORCED_PKG', description: 'unattended forced package operation' };
  }

  return null;
}

/**
 * Runs the full command scan.
 *
 * Order of evaluation matches the audited gate: legacy patterns first (so the
 * legacy contract and its indexes are preserved), then the hardened families.
 *
 * @param command - Raw command text.
 */
export function scanCommand(command: string): CommandScanMatch | null {
  const legacy = findLegacyMatch(command);

  if (legacy !== null) {
    return legacy;
  }

  const normalized = normalizeCommand(command);

  if (FORK_BOMB_PATTERN.test(normalized)) {
    return { rule: 'CMD.FORK_BOMB', description: 'fork bomb' };
  }

  const pipeline = classifyPipeline(normalized);

  if (pipeline !== null) {
    return pipeline;
  }

  for (const segment of splitCommandSegments(normalized)) {
    const match = scanSegment(segment);

    if (match !== null) {
      return match;
    }
  }

  return null;
}

/**
 * Reports whether a command matches any dangerous family.
 *
 * @param command - Command text.
 */
export function isDangerousCommandText(command: string): boolean {
  return scanCommand(command) !== null;
}
/** Result of scanning one command text. */

