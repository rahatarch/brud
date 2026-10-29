import type { PlatformPath } from 'node:path';
import type { PathRule } from '../contracts/rules.js';
import type {
  ValidationEnvironment,
  ValidationFlavor,
  ValidationWorkspacePort,
} from '../contracts/IValidationService.js';
import type { CommandScanMatch } from './commandPatterns.js';
import { pathApiFor, splitSegments } from './pathLexicon.js';
import { isContainedInRoot } from './pathLexicon.js';
import { scanCommand, normalizeCommand } from './commandPatterns.js';

/**
 * Hardened command scanner.
 *
 * Migrated from `packages/core/src/api/index.ts:187-244` and closes the nine
 * audited bypasses:
 *
 * - B-1/B-2: `rm -r -f /` and `rm --recursive --force /` are seen as the same
 *   force+recursive removal as `rm -rf /`.
 * - B-6: encoded payloads piped into a shell are blocked wherever they appear.
 * - B-7/B-8: `rm` behind `find -exec`, `xargs`, `env`, `nice`, `timeout`,
 *   `nohup`, `setsid` or `command` is unwrapped before inspection.
 * - B-9: the canonical `:&` fork bomb receives the same treatment as `:|`.
 * - B-10: `chmod 777 -R /` is order-insensitive.
 * - B-11: privilege escalation is case-insensitive (`SUDO`).
 * - B-17: `command cd /outside` is unwrapped before the cd tokenizer runs.
 *
 * Two further deviations from legacy, both documented by the audit (§3.4,
 * §3.6 B-21):
 *
 * - An unconfigured workspace no longer silently disables cd containment;
 *   the scanner reports `PATH.NO_WORKSPACE` through the orchestrator instead.
 * - Path resolution uses the injected flavor rather than the host `path`
 *   module, so `cd C:\\outside` behaves the same on every host.
 */

/** One `cd`-family chain decision. */
export interface CommandChainOutcome {
  /**
   * Rule violated, when the chain leaves the workspace or is dynamic.
   *
   * Reported with the `cd`-family owner vocabulary (`PATH.CWD_*`); the former
   * `CMD.CD_*` aliases were dead in the orchestrator and are retired.
   */
  readonly rule: Extract<PathRule, 'PATH.CWD_ESCAPE' | 'PATH.CWD_DYNAMIC'> | null;
  /** Target that caused the failure, for diagnostics. */
  readonly target?: string;
}

const CD_COMMANDS = ['cd', 'pushd', 'chdir'] as const;

/** Variable reference that cannot be resolved statically. */
const VARIABLE_REFERENCE_PATTERN = /\$\{?\w+\}?/u;

/** `$HOME` and `${HOME}` prefixes which may be expanded. */
const HOME_PREFIX_PATTERN = /^\$(?:HOME|\{HOME\})(?=[/\\]|$)/u;

/** Parentheses and control operators that end one command part. */
const PART_SPLIT_PATTERN = /\s*(?:&&|\|\||;|\||\(|\))\s*/u;

/** Optional wrapper prefix, itself stripped before `cd` detection. */
const WRAPPER_PREFIX_PATTERN =
  /^(?:[A-Za-z_][A-Za-z0-9_]*=.*?\s+)*(?:(?:sudo|doas|env|nice|nohup|setsid|timeout|command|exec)\b(?:\s+-\S+|\s+\d[\w.]*)?\s+)+/u;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * Scanner for dangerous commands and `cd` chains.
 *
 * The scanner is pure over its inputs: no filesystem access, no environment
 * lookup beyond the injected `homeDirectory`.
 */
export class CommandScannerEngine {
  private readonly api: PlatformPath;

  private readonly flavor: ValidationFlavor;

  private readonly workspace: ValidationWorkspacePort;

  private readonly homeDirectory: string;

  /**
   * @param workspace - Workspace authority used for cd containment.
   * @param environment - Home directory and path flavor.
   */
  constructor(workspace: ValidationWorkspacePort, environment: ValidationEnvironment) {
    this.flavor = environment.flavor;
    this.api = pathApiFor(environment.flavor);
    this.workspace = workspace;
    this.homeDirectory = environment.homeDirectory;
  }

  /**
   * Scans command text for a dangerous family.
   *
   * @param command - Command text.
   */
  scan(command: string): CommandScanMatch | null {
    return scanCommand(command);
  }

  /** Number of registered workspace roots. */
  get rootCount(): number {
    return this.workspace.roots.length;
  }

  /**
   * Evaluates every `cd`/`pushd`/`chdir` in a command chain.
   *
   * A relative target advances the chain, so `cd sub && cd ..` is evaluated
   * from the resulting directory rather than the original one.
   *
   * @param command - Command text.
   * @param cwd - Initial working directory.
   */
  evaluateChain(command: string, cwd: string | undefined): CommandChainOutcome {
    const initialCwd = cwd !== undefined && cwd.length > 0
      ? cwd
      : this.workspace.primaryRoot;
    const parts = command.split(PART_SPLIT_PATTERN);

    let currentCwd = initialCwd;

    for (const part of parts) {
      const trimmed = part.trim();

      if (trimmed.length === 0) {
        continue;
      }

      const unwrapped = trimmed.replace(WRAPPER_PREFIX_PATTERN, '').trim();
      const cdMatch = this.matchCd(unwrapped);

      if (cdMatch === null) {
        continue;
      }

      const target = cdMatch.target;

      if (target === undefined || target.length === 0) {
        continue;
      }

      const homeMatch = HOME_PREFIX_PATTERN.exec(target);

      if (homeMatch !== null) {
        const relativePart = target.slice(homeMatch[0].length);
        const expanded = this.expandHome(relativePart);

        if (!this.isInsideWorkspace(expanded, currentCwd)) {
          return { rule: 'PATH.CWD_ESCAPE', target: expanded };
        }

        currentCwd = expanded;

        continue;
      }

      if (VARIABLE_REFERENCE_PATTERN.test(target)) {
        return { rule: 'PATH.CWD_DYNAMIC', target };
      }

      const resolved = this.resolveTarget(target, currentCwd);

      if (resolved === null) {
        return { rule: 'PATH.CWD_ESCAPE', target };
      }

      currentCwd = resolved;
    }

    return { rule: null };
  }

  /**
   * Resolves a cwd argument for the legacy `validate.cwd` contract.
   *
   * @param cwd - Declared working directory, when any.
   */
  resolveCwd(cwd: string | undefined): string | null {
    if (cwd === undefined || cwd.trim().length === 0) {
      return this.workspace.roots.length === 0 ? null : this.workspace.primaryRoot;
    }

    if (!this.isInsideWorkspace(cwd, this.workspace.primaryRoot)) {
      return null;
    }

    const absolute = this.api.isAbsolute(cwd)
      ? this.api.resolve(cwd)
      : this.api.resolve(this.workspace.primaryRoot, cwd);

    return this.workspace.roots.some((root) => isContainedInRoot(root, absolute, this.flavor))
      ? absolute
      : null;
  }

  /**
   * Reports whether an absolute or workspace-relative candidate is inside.
   *
   * @param candidate - Path to test.
   * @param base - Directory a relative candidate is resolved from.
   */
  isInsideWorkspace(candidate: string, base: string): boolean {
    const root = this.routeRootFor(base);

    if (root === null) {
      return this.workspace.roots.length === 0;
    }

    const absolute = this.api.isAbsolute(candidate)
      ? this.api.resolve(candidate)
      : this.api.resolve(base, candidate);

    if (this.hasTraversalClimb(candidate)) {
      return isContainedInRoot(root, absolute, this.flavor);
    }

    return this.workspace.roots.some((registered) =>
      isContainedInRoot(registered, absolute, this.flavor));
  }

  private matchCd(part: string): { target?: string } | null {
    for (const command of CD_COMMANDS) {
      const pattern = new RegExp(`^${escapeRegExp(command)}(?:\\s+(.+))?$`, 'u');
      const match = pattern.exec(part);

      if (match !== null) {
        return match[1] === undefined ? {} : { target: match[1].trim() };
      }
    }

    return null;
  }

  private routeRootFor(base: string): string | null {
    const absolute = this.api.isAbsolute(base)
      ? this.api.resolve(base)
      : this.api.resolve(this.workspace.primaryRoot, base);

    for (const root of this.workspace.roots) {
      if (isContainedInRoot(root, absolute, this.flavor)) {
        return root;
      }
    }

    return null;
  }

  private hasTraversalClimb(candidate: string): boolean {
    const normalized = normalizeCommand(candidate);

    return splitSegments(normalized).some((segment) => segment === '..');
  }

  private resolveTarget(target: string, currentCwd: string): string | null {
    const stripped = target.replace(/^["']|["']$/gu, '');

    if (stripped === '-') {
      return this.workspace.roots.some((root) => isContainedInRoot(root, currentCwd, this.flavor))
        ? currentCwd
        : null;
    }

    if (stripped.startsWith('~')) {
      const expanded = this.expandHome(stripped.slice(1));

      return this.workspace.roots.some((root) => isContainedInRoot(root, expanded, this.flavor))
        ? expanded
        : null;
    }

    const base = this.api.isAbsolute(currentCwd)
      ? currentCwd
      : this.workspace.primaryRoot;
    const absolute = this.api.isAbsolute(stripped)
      ? this.api.resolve(stripped)
      : this.api.resolve(base, stripped);

    const owningRoot = this.workspace.roots.find((root) =>
      isContainedInRoot(root, base, this.flavor)) ?? this.workspace.roots[0];

    if (owningRoot === undefined) {
      return null;
    }

    return isContainedInRoot(owningRoot, absolute, this.flavor) ? absolute : null;
  }

  private expandHome(relativePart: string): string {
    const normalized = relativePart.replace(/^[/\\]+/u, '');
    const expanded = normalized.length === 0
      ? this.homeDirectory
      : this.api.resolve(this.homeDirectory, normalized);

    return this.flavor === 'win32' ? expanded.replace(/\//gu, '\\') : expanded;
  }
}
