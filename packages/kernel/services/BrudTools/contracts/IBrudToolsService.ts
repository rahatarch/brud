import type { OperationResult } from '../../../src/contracts/handler.js';
import type { IPluginDisposable } from '../../PluginManager/contracts/IPluginContext.js';

/**
 * Caller context handed to a tool handler at dispatch time.
 *
 * The service never leaks kernel internals to a tool: a handler receives the
 * workspace root, the identity of the caller that asked for execution, and the
 * cancellation signal of the in-flight request.
 */
export interface IPluginExecutionContext {
  /** Absolute path of the workspace the tool operates in. */
  readonly workspaceRoot: string;

  /** Identifier of the caller (plugin or surface) that requested execution. */
  readonly callerId: string;

  /** Cancellation signal of the request, when the transport supplied one. */
  readonly signal?: AbortSignal;

  /**
   * Permissions the caller holds at dispatch time.
   *
   * A tool's `requiredPermissions` are enforced as an all-of check: every
   * required permission must be present. An absent or empty set fails closed
   * for any tool that declares requirements.
   */
  readonly permissions?: readonly string[];

  /**
   * Origin marker of the dispatch surface, when one is known.
   *
   * Additive and intentionally not a provenance model: the daemon uses
   * `daemon-rpc` today, and in-process plugin calls omit it.
   */
  readonly origin?: string;
}

/**
 * Declarative definition of a tool a plugin publishes into the registry.
 *
 * One shape serves official and third-party tools alike (D-11): certification
 * is a derived field on {@link RegisteredToolInfo}, never a different contract.
 */
export interface ToolRegistrationOptions {
  /** Unique dispatch name, e.g. `read_file`. */
  readonly name: string;

  /** Human-readable description used by prompts and palettes. */
  readonly description: string;

  /** JSON Schema describing the accepted input payload. */
  readonly parametersSchema: Record<string, unknown>;

  /** Permissions the tool requires from its caller. */
  readonly requiredPermissions?: readonly string[];

  /** Handler invoked after the schema gate admits the payload. */
  readonly execute: (
    input: Record<string, unknown>,
    context: IPluginExecutionContext,
  ) => Promise<OperationResult>;
}

/**
 * Caller-facing projection of a registered tool.
 *
 * The raw `execute` closure is stripped so a consumer can describe a tool
 * without acquiring a way to run it; execution only happens through
 * {@link IBrudToolsService.executeTool}.
 */
export type RegisteredToolInfo = Omit<ToolRegistrationOptions, 'execute'> & {
  /** Plugin that registered the tool. */
  readonly ownerPluginId: string;

  /** Certification status derived by the kernel from the plugin brand. */
  readonly isOfficial: boolean;
};

/** Query filter accepted by {@link IBrudToolsService.listTools}. */
export interface ListToolsFilter {
  /** Restrict the result to certified official tools. */
  readonly officialOnly?: boolean;
}

/**
 * Level-1 live tool registry, certification store and dispatch table.
 *
 * Contract frozen by rollout plan G-18 (§3.1). `getTool` is the only lookup
 * the stream block parser performs, so routing never inspects plugins.
 */
export interface IBrudToolsService {
  /**
   * Registers a tool on behalf of a plugin.
   *
   * `pluginId` and `isOfficial` are supplied by the kernel, never asserted by
   * the registrant. Duplicate names are rejected with `ToolDuplicateError`.
   *
   * @param pluginId - Owning plugin identifier.
   * @param isOfficial - Certification status derived by the kernel.
   * @param options - Tool definition and handler.
   * @returns Disposable that removes the entry exactly once.
   */
  registerTool(
    pluginId: string,
    isOfficial: boolean,
    options: ToolRegistrationOptions,
  ): IPluginDisposable;

  /**
   * Resolves a registered tool by name.
   *
   * @param name - Dispatch name.
   * @returns The frozen projection, or `undefined` when no tool matches.
   */
  getTool(name: string): RegisteredToolInfo | undefined;

  /**
   * Lists registered tools, optionally restricted to official ones.
   *
   * @param filter - Optional query filter.
   */
  listTools(filter?: ListToolsFilter): readonly RegisteredToolInfo[];

  /**
   * Validates and dispatches one tool invocation.
   *
   * Validation is performed against the target tool's registered
   * `parametersSchema` only. There is no operation-kind gate and no
   * implicit `index`: a payload is accepted exactly when the tool's own
   * schema accepts it.
   *
   * Never throws for lookup or validation failures; those become `failed`
   * results. Handler faults propagate to the caller.
   *
   * @param name - Dispatch name.
   * @param rawInput - Untrusted payload supplied by the caller.
   * @param callerContext - Execution context handed to the handler.
   */
  executeTool(
    name: string,
    rawInput: unknown,
    callerContext: IPluginExecutionContext,
  ): Promise<OperationResult>;

  /**
   * Validates a payload against a tool without invoking its handler.
   *
   * This is the dry-run gate used by the Router. Lookup, allow-list and schema
   * validation run; caller permissions are not checked.
   *
   * @param name - Dispatch name.
   * @param rawInput - Untrusted payload supplied by the caller.
   * @param callerContext - Execution context that would be used on dispatch.
   */
  validateTool(
    name: string,
    rawInput: unknown,
    callerContext: IPluginExecutionContext,
  ): OperationResult;
}

/**
 * Read-only projection of the tool registry.
 *
 * Handlers such as the Catalog plugin need to describe the registry without
 * acquiring registration or dispatch authority. This slice exposes exactly
 * the two lookup operations, so callers cannot mutate the registry or invoke a
 * tool through the facade.
 */
export type IBrudToolsReader = Pick<IBrudToolsService, 'getTool' | 'listTools'>;
