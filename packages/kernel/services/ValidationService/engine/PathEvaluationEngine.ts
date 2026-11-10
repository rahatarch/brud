import type { PathRule } from '../contracts/rules.js';
import type {
  OperationAccess,
  ValidatedPath,
  ValidationFlavor,
  ValidationWorkspacePort,
} from '../contracts/IValidationService.js';
import { PathViolationError } from '../contracts/errors.js';
import type { InputSchemaEngine } from './InputSchemaEngine.js';
import { LexicalPathEngine } from './LexicalPathEngine.js';
import { isA10ProtectedPath } from '../model/policy.js';
import type { IgnoreRulesRegistry } from '../model/ignoreRules.js';
import {
  classifyPath,
  isContainedInRoot,
  pathApiFor,
  splitSegments,
} from './pathLexicon.js';
import { kindConstraint } from './kindMatrix.js';

/** Outcome of a path evaluation. */
export type PathEvaluation =
  | { readonly ok: true; readonly location: ValidatedPath }
  | { readonly ok: false; readonly rule: PathRule; readonly path: string; readonly reason: string };

/**
 * Canonical event order for path rules.
 *
 * When several rules reject the same input the earliest one wins, so the
 * reported rule is deterministic for a given policy.
 */
const RULE_PRECEDENCE: readonly PathRule[] = Object.freeze([
  'PATH.NO_WORKSPACE',
  'PATH.NON_STRING',
  'PATH.INVALID_ROOT',
  'PATH.NULL_BYTE',
  'PATH.UNC_OR_DEVICE',
  'PATH.WIN_ALT_DATA_STREAM',
  'PATH.DRIVE_QUALIFIED',
  'PATH.DRIVE_RELATIVE',
  'PATH.ABSOLUTE',
  'PATH.PARENT_SEGMENT',
  'PATH.WIN_TRAILING_DOT_OR_SPACE',
  'PATH.WIN_TRAILING_ALIAS_TRAVERSAL',
  'PATH.WIN_RESERVED_DEVICE',
  'PATH.OUTSIDE_ROOT',
  'PATH.SIBLING_PREFIX',
  'PATH.SYMLINK_ESCAPE',
  'PATH.UNVERIFIABLE_LINEAGE',
  'PATH.AMBIGUOUS_ROOT',
  'PATH.UNKNOWN_ROOT',
  'PATH.PROTECTED_DENY',
  'PATH.USER_IGNORED',
  'PATH.ROOT_NOT_MUTABLE',
]);

const REASONS: Readonly<Partial<Record<PathRule, string>>> = Object.freeze({
  'PATH.NULL_BYTE': 'path contains a null byte',
  'PATH.UNC_OR_DEVICE': 'UNC, device, and drive-relative paths are not permitted',
  'PATH.DRIVE_QUALIFIED': 'drive-qualified paths are not permitted',
  'PATH.DRIVE_RELATIVE': 'drive-relative paths are not permitted',
  'PATH.ABSOLUTE': 'absolute paths are not permitted',
  'PATH.PARENT_SEGMENT': 'parent traversal segments are not permitted',
  'PATH.WIN_TRAILING_DOT_OR_SPACE': 'Windows path segments with trailing dots or spaces are not permitted',
  'PATH.WIN_TRAILING_ALIAS_TRAVERSAL': 'Windows path segments must not resolve to "." or ".." after trailing dots and spaces are trimmed',
  'PATH.WIN_RESERVED_DEVICE': 'Windows reserved device names are not permitted',
  'PATH.WIN_ALT_DATA_STREAM': 'Windows alternate data streams are not permitted',
  'PATH.INVALID_ROOT': 'the workspace root registry is not usable',
  'PATH.NO_WORKSPACE': 'no workspace root is registered',
  'PATH.NON_STRING': 'path must be a string',
  'PATH.PROTECTED_DENY': 'the path is on the kernel protected-path denylist',
  'PATH.USER_IGNORED': 'the path is ignored by the workspace .brudignore policy',
  'PATH.ROOT_NOT_MUTABLE': 'the workspace root is not a mutable target',
  'PATH.OUTSIDE_ROOT': 'the path is outside every workspace root',
});

/** Workspace rule name → kernel path rule. */
const WORKSPACE_RULE_MAP: Readonly<Record<string, PathRule>> = Object.freeze({
  NULL_BYTE: 'PATH.NULL_BYTE',
  TRAVERSAL: 'PATH.UNC_OR_DEVICE',
  RESERVED_DEVICE: 'PATH.WIN_RESERVED_DEVICE',
  ALTERNATE_DATA_STREAM: 'PATH.WIN_ALT_DATA_STREAM',
  OUTSIDE_ROOT: 'PATH.OUTSIDE_ROOT',
  SIBLING_PREFIX: 'PATH.SIBLING_PREFIX',
  SYMLINK_ESCAPE: 'PATH.SYMLINK_ESCAPE',
  AMBIGUOUS_ROOT: 'PATH.AMBIGUOUS_ROOT',
  FILESYSTEM_ROOT: 'PATH.INVALID_ROOT',
  UNKNOWN_ROOT: 'PATH.UNKNOWN_ROOT',
  UNVERIFIABLE_LINEAGE: 'PATH.UNVERIFIABLE_LINEAGE',
  INVALID_INPUT: 'PATH.NON_STRING',
  PATH_VIOLATION: 'PATH.ROOT_NOT_MUTABLE',
  PROTECTED_PATH_DENIED: 'PATH.PROTECTED_DENY',
});

function precedence(rule: PathRule): number {
  const index = RULE_PRECEDENCE.indexOf(rule);

  return index < 0 ? RULE_PRECEDENCE.length : index;
}

/** Access aliases accepted in place of a catalogued operation kind. */
const ACCESS_ALIASES: ReadonlySet<OperationAccess> = new Set<OperationAccess>([
  'read',
  'mutate',
  'delete',
  'catalog',
]);

function isAccessAlias(value: string): value is OperationAccess {
  return ACCESS_ALIASES.has(value as OperationAccess);
}

function firstViolation(rules: readonly PathRule[]): PathRule | null {
  if (rules.length === 0) {
    return null;
  }

  return rules.reduce<PathRule>(
    (current, candidate) => (precedence(candidate) < precedence(current) ? candidate : current),
    rules[0] as PathRule,
  );
}

/**
 * Path evaluation against frozen boundary policy.
 *
 * Three layers, in order:
 *
 * 1. **Lexical integrity** (`PATH.NULL_BYTE`, `PATH.UNC_OR_DEVICE`,
 *    `PATH.PARENT_SEGMENT`, Windows device/ADS/trailing rules). Always applied;
 *    never gated by policy, because these are integrity rules rather than
 *    boundary rules.
 * 2. **Containment** (`PATH.OUTSIDE_ROOT`, `PATH.SIBLING_PREFIX`,
 *    `PATH.SYMLINK_ESCAPE`, …) delegated to `WorkspaceService.resolve` and
 *    applied only while `workspaceBoundaryEnabled` is frozen `true`.
 * 3. **A10 denylist** (`PATH.PROTECTED_DENY`, `PATH.ROOT_NOT_MUTABLE`) applied
 *    to every mutating and deleting kind, directory kinds included.
 */
export class PathEvaluationEngine {
  private readonly workspace: ValidationWorkspacePort;

  private readonly flavor: ValidationFlavor;

  private readonly boundaryEnabled: boolean;

  private readonly schema: InputSchemaEngine;

  private readonly ignoreRules: IgnoreRulesRegistry;

  /**
   * @param workspace - Workspace containment authority.
   * @param flavor - Path flavor.
   * @param boundaryEnabled - Frozen `workspaceBoundaryEnabled`.
   * @param schema - Input engine used to classify operation kinds.
   * @param ignoreRules - Frozen `.brudignore` policy registry.
   */
  constructor(
    workspace: ValidationWorkspacePort,
    flavor: ValidationFlavor,
    boundaryEnabled: boolean,
    schema: InputSchemaEngine,
    ignoreRules: IgnoreRulesRegistry,
  ) {
    this.workspace = workspace;
    this.flavor = flavor;
    this.boundaryEnabled = boundaryEnabled;
    this.schema = schema;
    this.ignoreRules = ignoreRules;
  }

  /**
   * Lexical engine over the primary root, built on demand.
   *
   * Built lazily so the workspace authority is never touched during service
   * construction (boot-time composition may construct this engine before the
   * workspace token is resolvable).
   */
  private get lexical(): LexicalPathEngine | null {
    const root = this.workspace.primaryRoot;

    return root.length > 0 ? new LexicalPathEngine(root, { flavor: this.flavor }) : null;
  }

  /**
   * Evaluates a path for an operation kind.
   *
   * @param input - Absolute or relative path.
   * @param operationKind - Operation kind, defaulting to read semantics.
   */
  async evaluate(input: string, operationKind?: string): Promise<PathEvaluation> {
    if (this.workspace.roots.length === 0) {
      return { ok: false, rule: 'PATH.NO_WORKSPACE', path: String(input), reason: REASONS['PATH.NO_WORKSPACE'] ?? '' };
    }

    const kind = this.resolveKind(operationKind);

    if (kind === null) {
      return {
        ok: false,
        rule: 'PATH.NON_STRING',
        path: input,
        reason: `unknown operation kind "${String(operationKind)}"`,
      };
    }

    const lexicalFailure = this.classifyLexical(input, kind);

    if (lexicalFailure !== null) {
      return lexicalFailure;
    }

    if (!this.boundaryEnabled) {
      return this.evaluateUncontained(input, kind);
    }

    return this.evaluateContained(input, kind);
  }

  /**
   * Evaluates a path synchronously, using the registered roots as the
   * containment authority.
   *
   * The `BrudAPI.validate` boundary is synchronous and cannot await
   * `workspace.resolve`. This method runs the *same* lexical rules, the *same*
   * boundary switch and the *same* A10 denylist; only the containment proof
   * differs (segment-aware lexical containment instead of `realpath`). The
   * asynchronous {@link evaluate} remains authoritative wherever a caller can
   * await.
   *
   * @param input - Absolute or relative path.
   * @param operationKind - Operation kind, defaulting to read semantics.
   */
  evaluateSync(input: string, operationKind?: string): PathEvaluation {
    if (this.workspace.roots.length === 0) {
      return { ok: false, rule: 'PATH.NO_WORKSPACE', path: String(input), reason: REASONS['PATH.NO_WORKSPACE'] ?? '' };
    }

    const kind = this.resolveKind(operationKind);

    if (kind === null) {
      return { ok: false, rule: 'PATH.NON_STRING', path: input, reason: `unknown operation kind "${String(operationKind)}"` };
    }

    const lexicalFailure = this.classifyLexical(input, kind);

    if (lexicalFailure !== null) {
      return lexicalFailure;
    }

    if (!this.boundaryEnabled) {
      return this.evaluateUncontained(input, kind);
    }

    const classification = classifyPath(input, this.flavor);

    if (classification.kind === 'ambiguous-absolute') {
      return { ok: false, rule: 'PATH.UNC_OR_DEVICE', path: input, reason: REASONS['PATH.UNC_OR_DEVICE'] ?? '' };
    }

    const absolute = classification.kind === 'absolute'
      ? classification.normalized
      : pathApiFor(this.flavor).resolve(this.workspace.primaryRoot, input);

    const owningRoot = this.workspace.roots.find((root) =>
      isContainedInRoot(root, absolute, this.flavor));

    if (owningRoot === undefined) {
      return { ok: false, rule: 'PATH.OUTSIDE_ROOT', path: input, reason: REASONS['PATH.OUTSIDE_ROOT'] ?? '' };
    }

    const relativePath = toForwardRelative(owningRoot, absolute, this.flavor);

    if (this.isMutating(kind) && relativePath === '') {
      return { ok: false, rule: 'PATH.ROOT_NOT_MUTABLE', path: input, reason: REASONS['PATH.ROOT_NOT_MUTABLE'] ?? '' };
    }

    const policyFailure = this.classifyPolicySync(owningRoot, relativePath, input);

    if (policyFailure !== null) {
      return policyFailure;
    }

    return {
      ok: true,
      location: {
        absolutePath: absolute,
        path: input,
        root: owningRoot,
        relativePath,
        operationKind: kind,
      },
    };
  }

  /**
   * Reports whether a relative kernel path is a mutable target.
   *
   * @param relativePath - Kernel-relative path.
   */
  isMutableTarget(relativePath: string): boolean {
    return this.lexical?.isMutableTarget(relativePath) ?? false;
  }

  private classifyLexical(input: string, kind: string): PathEvaluation | null {
    const classification = classifyPath(input, this.flavor);

    if (classification.kind === 'root') {
      return this.isMutating(kind)
        ? { ok: false, rule: 'PATH.ROOT_NOT_MUTABLE', path: input, reason: REASONS['PATH.ROOT_NOT_MUTABLE'] ?? '' }
        : null;
    }

    const violated: PathRule[] = [];

    if (this.lexical !== null) {
      for (const outcome of this.lexical.classify(input)) {
        if (outcome.violated && !(classification.kind === 'absolute' && outcome.rule === 'PATH.ABSOLUTE')) {
          violated.push(outcome.rule);
        }
      }
    } else if (classification.kind === 'ambiguous-absolute') {
      violated.push('PATH.UNC_OR_DEVICE');
    }

    if (classification.kind === 'ambiguous-absolute' && violated.length === 0) {
      violated.push('PATH.UNC_OR_DEVICE');
    }

    if (violated.length > 0 && this.lexical === null) {
      return { ok: false, rule: firstViolation(violated) ?? 'PATH.UNC_OR_DEVICE', path: input, reason: 'the path is not permitted' };
    }

    const rule = firstViolation(violated);

    return rule === null
      ? null
      : { ok: false, rule, path: input, reason: REASONS[rule] ?? 'the path is not permitted' };
  }

  private evaluateUncontained(input: string, kind: string): PathEvaluation {
    const classification = classifyPath(input, this.flavor);
    const relativePath = classification.kind === 'absolute'
      ? toForwardRelative(this.workspace.primaryRoot, classification.normalized, this.flavor)
      : input;

    // With containment disabled an absolute path outside the root is admitted
    // as-is, exactly as the previous validator resolved it against the first
    // folder. Lexical segment rules still apply to the relative form, and A10
    // still applies when the target lands inside the root's own namespace.
    const insideRoot = !relativePath.startsWith('..') && !splitSegments(relativePath).includes('..');

    if (!insideRoot) {
      return {
        ok: true,
        location: {
          absolutePath: classification.kind === 'absolute' ? classification.normalized : input,
          path: input,
          root: this.workspace.primaryRoot,
          relativePath: '',
          operationKind: kind,
        },
      };
    }

    if (this.lexical === null) {
      if (this.isMutating(kind) && relativePath === '') {
        return { ok: false, rule: 'PATH.ROOT_NOT_MUTABLE', path: input, reason: REASONS['PATH.ROOT_NOT_MUTABLE'] ?? '' };
      }

      const policyFailure = this.classifyPolicySync(this.workspace.primaryRoot, relativePath, input);

      if (policyFailure !== null) {
        return policyFailure;
      }

      return {
        ok: true,
        location: {
          absolutePath: classification.kind === 'absolute'
            ? classification.normalized
            : this.workspace.toAbsolutePath(relativePath),
          path: input,
          root: this.workspace.primaryRoot,
          relativePath,
          operationKind: kind,
        },
      };
    }

    let absolutePath: string;

    try {
      absolutePath = this.lexical.resolve(relativePath);
    } catch (error: unknown) {
      if (error instanceof PathViolationError) {
        return { ok: false, rule: error.rule as PathRule, path: input, reason: error.reason };
      }

      throw error;
    }

    const resolvedRelative = toForwardRelative(this.workspace.primaryRoot, absolutePath, this.flavor);

    if (this.isMutating(kind) && resolvedRelative === '') {
      return { ok: false, rule: 'PATH.ROOT_NOT_MUTABLE', path: input, reason: REASONS['PATH.ROOT_NOT_MUTABLE'] ?? '' };
    }

    const policyFailure = this.classifyPolicySync(this.workspace.primaryRoot, resolvedRelative, input);

    if (policyFailure !== null) {
      return policyFailure;
    }

    return {
      ok: true,
      location: {
        absolutePath,
        path: input,
        root: this.workspace.primaryRoot,
        relativePath: resolvedRelative,
        operationKind: kind,
      },
    };
  }

  private async evaluateContained(input: string, kind: string): Promise<PathEvaluation> {
    let location: { readonly root: string; readonly absolutePath: string; readonly relativePath: string };

    try {
      location = await this.workspace.resolve(input);
    } catch (error: unknown) {
      const candidate = error as { rule?: string; reason?: string; code?: unknown };

      if (typeof candidate?.code !== 'string') {
        throw error;
      }

      if (candidate.code === 'WORKSPACE_CONFIGURATION_INVALID') {
        return {
          ok: false,
          rule: 'PATH.INVALID_ROOT',
          path: input,
          reason: candidate.reason ?? 'the workspace root registry is not usable',
        };
      }

      const mapped = WORKSPACE_RULE_MAP[candidate.rule ?? ''] ?? 'PATH.OUTSIDE_ROOT';

      return {
        ok: false,
        rule: mapped,
        path: input,
        reason: candidate.reason ?? REASONS[mapped] ?? 'the path is outside the workspace',
      };
    }

    if (this.isMutating(kind) && (location.relativePath === '' || location.relativePath === '.')) {
      return { ok: false, rule: 'PATH.ROOT_NOT_MUTABLE', path: input, reason: REASONS['PATH.ROOT_NOT_MUTABLE'] ?? '' };
    }

    const policyFailure = await this.classifyPolicy(location.root, location.relativePath, input);

    if (policyFailure !== null) {
      return policyFailure;
    }

    return {
      ok: true,
      location: {
        absolutePath: location.absolutePath,
        path: input,
        root: location.root,
        relativePath: location.relativePath,
        operationKind: kind,
      },
    };
  }

  private async classifyPolicy(
    root: string,
    relativePath: string,
    input: string,
  ): Promise<PathEvaluation | null> {
    if (isA10ProtectedPath(relativePath)) {
      return {
        ok: false,
        rule: 'PATH.PROTECTED_DENY',
        path: input,
        reason: REASONS['PATH.PROTECTED_DENY'] ?? '',
      };
    }

    if (await this.ignoreRules.isIgnored(root, relativePath)) {
      return {
        ok: false,
        rule: 'PATH.USER_IGNORED',
        path: input,
        reason: REASONS['PATH.USER_IGNORED'] ?? '',
      };
    }

    return null;
  }

  private classifyPolicySync(
    root: string,
    relativePath: string,
    input: string,
  ): PathEvaluation | null {
    if (isA10ProtectedPath(relativePath)) {
      return {
        ok: false,
        rule: 'PATH.PROTECTED_DENY',
        path: input,
        reason: REASONS['PATH.PROTECTED_DENY'] ?? '',
      };
    }

    if (this.ignoreRules.isIgnoredSync(root, relativePath)) {
      return {
        ok: false,
        rule: 'PATH.USER_IGNORED',
        path: input,
        reason: REASONS['PATH.USER_IGNORED'] ?? '',
      };
    }

    return null;
  }

  private resolveKind(operationKind?: string): string | null {
    if (operationKind === undefined) {
      return 'read_file';
    }

    if (isAccessAlias(operationKind)) {
      return operationKind;
    }

    return this.schema.isKnownOperation(operationKind) ? operationKind : null;
  }

  private accessOf(kind: string): OperationAccess {
    if (isAccessAlias(kind)) {
      return kind;
    }

    return kindConstraint(kind)?.access ?? 'read';
  }

  private isMutating(kind: string): boolean {
    const access = this.accessOf(kind);

    return access === 'mutate' || access === 'delete';
  }
}

/**
 * Converts an absolute path into a `'/'`-separated path relative to a root.
 *
 * Segment-aware and flavor-aware: a target outside the root yields `..`-prefixed
 * text, which is how the boundary-disabled path knows it is uncontained.
 *
 * @param root - Root path.
 * @param absolutePath - Absolute candidate.
 * @param flavor - Path flavor.
 */
function toForwardRelative(root: string, absolutePath: string, flavor: ValidationFlavor): string {
  if (root.length === 0) {
    return absolutePath;
  }

  const relative = pathApiFor(flavor).relative(root, absolutePath);

  if (relative === '' || relative === '.') {
    return '';
  }

  return relative.split(/[\\/]+/u).join('/');
}
