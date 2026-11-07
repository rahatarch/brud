import type { ValidationFlavor } from '../contracts/IValidationService.js';
import { pathApiFor } from '../engine/pathLexicon.js';
import { normalizePolicyPath } from './policy.js';

/** Maximum number of peer patterns accepted from a `.brudignore` file. */
export const MAX_IGNORE_PATTERNS = 1_000;

/** Maximum length of one `.brudignore` pattern. */
export const MAX_IGNORE_PATTERN_LENGTH = 512;

/** Reader the registry uses to load `<root>/.brudignore` exactly once. */
export type IgnoreFileReader = (absolutePath: string) => Promise<Uint8Array>;

interface IgnoreRule {
  readonly regex: RegExp;
  readonly negate: boolean;
}

function escapeRegExp(character: string): string {
  return /[|\\{}()[\]^$+*?.]/u.test(character) ? `\\${character}` : character;
}

/**
 * Converts one gitignore glob into an anchored or floating regular expression.
 *
 * The generated expression always accepts a trailing `/` so a pattern that
 * matches a directory also matches everything beneath it.
 *
 * @param glob - Pattern with leading/trailing markers already stripped.
 * @param anchored - Whether the pattern is fixed at the workspace root.
 * @param flavor - Path flavor; Windows matching is case-insensitive.
 */
function globToRegExp(
  glob: string,
  anchored: boolean,
  flavor: ValidationFlavor,
): RegExp {
  let source = '';
  let index = 0;

  while (index < glob.length) {
    const character = glob[index] as string;

    if (character === '*') {
      if (glob[index + 1] === '*') {
        while (glob[index + 1] === '*') {
          index += 1;
        }

        if (glob[index + 1] === '/') {
          index += 1;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (character === '?') {
      source += '[^/]';
    } else if (character === '[') {
      const closing = glob.indexOf(']', index + 1);

      if (closing === -1) {
        source += '\\[';
      } else {
        const body = glob.slice(index + 1, closing);
        const negated = body.startsWith('!') ? `^${body.slice(1)}` : body;

        source += `[${negated}]`;
        index = closing;
      }
    } else {
      source += escapeRegExp(character);
    }

    index += 1;
  }

  const prefix = anchored ? '^' : '(?:^|/)';
  const flags = flavor === 'win32' ? 'iu' : 'u';

  return new RegExp(`${prefix}${source}(?:$|/)`, flags);
}

/**
 * In-memory matcher for the user-owned `.brudignore` file.
 *
 * Supports blank lines, `#` comments, `!` negation, leading `/` anchoring,
 * internal-slash anchoring, trailing `/` directory patterns, `*`, `**`, `?`,
 * and character classes. Rules are evaluated in file order and the last
 * matching rule wins, matching gitignore semantics.
 *
 * The matcher never touches the filesystem: `IgnoreRulesRegistry` reads the
 * file once and the parsed rules stay immutable.
 */
export class WorkspaceIgnoreRules {
  public static readonly empty: WorkspaceIgnoreRules = new WorkspaceIgnoreRules([]);

  private readonly rules: readonly IgnoreRule[];

  /** Number of parsed patterns, excluding comments and blank lines. */
  public readonly size: number;

  constructor(patterns: readonly string[], flavor: ValidationFlavor = 'posix') {
    const rules: IgnoreRule[] = [];

    for (const raw of patterns) {
      if (rules.length >= MAX_IGNORE_PATTERNS) {
        break;
      }

      const parsed = parsePattern(raw, flavor);

      if (parsed !== null) {
        rules.push(parsed);
      }
    }

    this.rules = rules;
    this.size = rules.length;
  }

  /** Parses the textual content of a `.brudignore` file. */
  public static parse(
    content: string,
    flavor: ValidationFlavor = 'posix',
  ): WorkspaceIgnoreRules {
    return new WorkspaceIgnoreRules(content.split(/\r?\n/u), flavor);
  }

  /**
   * Reports whether a workspace-relative path is ignored.
   *
   * @param relativePath - Path relative to the workspace root.
   */
  public isIgnored(relativePath: string): boolean {
    const normalized = normalizePolicyPath(relativePath);

    if (normalized.length === 0) {
      return false;
    }

    const candidate = `${normalized}/`;
    let ignored = false;

    for (const rule of this.rules) {
      if (rule.regex.test(candidate)) {
        ignored = !rule.negate;
      }
    }

    return ignored;
  }
}

function parsePattern(raw: string, flavor: ValidationFlavor): IgnoreRule | null {
  let line = raw.trim();

  if (line.length === 0 || line.startsWith('#')) {
    return null;
  }

  let negate = false;

  if (line.startsWith('\\!')) {
    line = line.slice(1);
  } else if (line.startsWith('!')) {
    negate = true;
    line = line.slice(1);
  }

  if (line.length === 0 || line.length > MAX_IGNORE_PATTERN_LENGTH) {
    return null;
  }

  if (line.endsWith('/')) {
    line = line.slice(0, -1);
  }

  let anchored = false;

  if (line.startsWith('/')) {
    anchored = true;
    line = line.slice(1);
  } else if (line.includes('/')) {
    anchored = true;
  }

  if (line.length === 0) {
    return null;
  }

  try {
    return { regex: globToRegExp(line, anchored, flavor), negate };
  } catch {
    return null;
  }
}

function isMissingFileError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  const code = (error as { readonly code?: unknown }).code;

  return code === 'ENOENT' || code === 'ENOTDIR';
}

function rootIdentity(root: string, flavor: ValidationFlavor): string {
  return flavor === 'win32' ? root.toLowerCase() : root;
}

/**
 * Lazily loads and caches the user-owned `.brudignore` for every root.
 *
 * Reading happens on the first validation of a root and is memoized for the
 * lifetime of the frozen policy. A missing or unreadable policy file applies
 * no user rules and never fails a workspace, matching the pre-consolidation
 * fail-open behavior.
 */
export class IgnoreRulesRegistry {
  private readonly cache = new Map<string, WorkspaceIgnoreRules>();

  private readonly pending = new Map<string, Promise<WorkspaceIgnoreRules>>();

  constructor(
    private readonly flavor: ValidationFlavor,
    private readonly readFile?: IgnoreFileReader,
  ) {}

  /**
   * Returns the parsed rules for a root, loading them once.
   *
   * @param root - Canonical workspace root.
   */
  async rulesFor(root: string): Promise<WorkspaceIgnoreRules> {
    const key = rootIdentity(root, this.flavor);
    const cached = this.cache.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const inFlight = this.pending.get(key);

    if (inFlight !== undefined) {
      return inFlight;
    }

    const load = this.load(root)
      .then((rules) => {
        this.cache.set(key, rules);
        this.pending.delete(key);

        return rules;
      })
      .catch(() => {
        this.pending.delete(key);

        return WorkspaceIgnoreRules.empty;
      });

    this.pending.set(key, load);

    return load;
  }

  /**
   * Returns the already-loaded rules for a root, or the empty set.
   *
   * Used by the synchronous legacy boundary, which cannot await the first
   * load. A later asynchronous validation populates the cache for it.
   *
   * @param root - Canonical workspace root.
   */
  cached(root: string): WorkspaceIgnoreRules {
    return this.cache.get(rootIdentity(root, this.flavor)) ?? WorkspaceIgnoreRules.empty;
  }

  /**
   * Asynchronously reports whether a workspace-relative path is ignored.
   *
   * @param root - Canonical workspace root.
   * @param relativePath - Workspace-relative path.
   */
  async isIgnored(root: string, relativePath: string): Promise<boolean> {
    return (await this.rulesFor(root)).isIgnored(relativePath);
  }

  /**
   * Synchronously reports whether a cached ruleset ignores a path.
   *
   * @param root - Canonical workspace root.
   * @param relativePath - Workspace-relative path.
   */
  isIgnoredSync(root: string, relativePath: string): boolean {
    return this.cached(root).isIgnored(relativePath);
  }

  private async load(root: string): Promise<WorkspaceIgnoreRules> {
    const readFile = this.readFile;

    if (readFile === undefined) {
      return WorkspaceIgnoreRules.empty;
    }

    const ignorePath = pathApiFor(this.flavor).resolve(root, '.brudignore');

    try {
      const bytes = await readFile(ignorePath);
      const content = new TextDecoder('utf-8').decode(bytes);

      return WorkspaceIgnoreRules.parse(content, this.flavor);
    } catch (error: unknown) {
      if (isMissingFileError(error)) {
        return WorkspaceIgnoreRules.empty;
      }

      return WorkspaceIgnoreRules.empty;
    }
  }
}