import type { OperationResult } from '@brud/kernel';

/**
 * Caller context handed to an action handler at execution time.
 *
 * The UI-facing daemon supplies this context; a plugin handler never receives
 * a kernel service, a broker, or another plugin's context. It carries only the
 * identity of the UI caller.
 */
export interface IActionExecutionContext {
  /** Identifier of the UI caller that requested execution. */
  readonly callerId: string;

  /** Cancellation signal of the request, when the transport supplied one. */
  readonly signal?: AbortSignal;

  /** Origin marker of the dispatch surface, e.g. `daemon-rpc`. */
  readonly origin?: string;
}

/**
 * Declarative definition of a UI-only action a plugin publishes.
 *
 * Actions are the fourth Brud primitive: UI-only endpoints that never appear
 * in the tool catalog or in any AI/MCP surface. A plugin may register an
 * action; it can never execute one.
 */
export interface ActionRegistrationOptions {
  /** Unique action name, e.g. `list_sessions`. */
  readonly name: string;

  /** Human-readable description used by the UI palette. */
  readonly description: string;

  /** JSON Schema describing the accepted input payload. */
  readonly parametersSchema: Record<string, unknown>;

  /** Handler invoked after the schema gate admits the payload. */
  readonly execute: (
    input: Record<string, unknown>,
    context: IActionExecutionContext,
  ) => Promise<OperationResult>;
}

/**
 * Handler-free projection of a registered action.
 *
 * The raw `execute` closure is stripped so a consumer can describe an action
 * without acquiring a way to run it. Dispatch only happens through
 * {@link IActionManager.executeAction}.
 */
export type RegisteredActionInfo = Omit<ActionRegistrationOptions, 'execute'> & {
  /** Plugin that registered the action. */
  readonly ownerPluginId: string;
};

/**
 * A resource released when an action registration is disposed.
 *
 * Structurally identical to the plugin manager's disposable so the plugin
 * context can forward it without importing the ActionManager. Declared here so
 * the ActionManager never imports PluginManager.
 */
export interface IActionDisposable {
  /** Releases the registration. Implementations must be safe to call once. */
  dispose(): void | Promise<void>;
}

/**
 * Level-1 UI-only action registry and dispatch table.
 *
 * The registry is deliberately unidirectional: plugins register through
 * {@link registerAction}; only the daemon/UI resolve the service to call
 * {@link listActions} and {@link executeAction}. There is no reader exposed to
 * a plugin context, and no `execute` handle is ever projected.
 */
export interface IActionManager {
  /**
   * Registers an action on behalf of a plugin.
   *
   * `pluginId` is supplied by the plugin manager, never asserted by the
   * registrant. Duplicate names are rejected with `ActionDuplicateError`.
   *
   * @param pluginId - Owning plugin identifier.
   * @param options - Action definition and handler.
   * @returns Disposable that removes the entry exactly once.
   */
  registerAction(pluginId: string, options: ActionRegistrationOptions): IActionDisposable;

  /**
   * Resolves a registered action by name.
   *
   * @param name - Action name.
   * @returns The frozen projection, or `undefined` when no action matches.
   */
  getAction(name: string): RegisteredActionInfo | undefined;

  /**
   * Lists registered actions.
   *
   * @returns Handler-free projections in registration order.
   */
  listActions(): readonly RegisteredActionInfo[];

  /**
   * Validates and dispatches one action invocation.
   *
   * The input is checked against the target action's registered
   * `parametersSchema` before the handler runs. Lookup, schema and handler
   * failures all resolve to a structured `failed` result.
   *
   * @param name - Action name.
   * @param rawInput - Untrusted payload supplied by the UI caller.
   * @param callerContext - Context handed to the handler.
   */
  executeAction(
    name: string,
    rawInput: unknown,
    callerContext: IActionExecutionContext,
  ): Promise<OperationResult>;

  /**
   * Validates a payload against an action without invoking its handler.
   *
   * This is the dry-run gate used by the Router. Lookup and the schema gate
   * run; no handler is called.
   *
   * @param name - Action name.
   * @param rawInput - Untrusted payload supplied by the UI caller.
   */
  validateAction(name: string, rawInput: unknown): OperationResult;
}

/**
 * Read-only projection of the action registry.
 *
 * Exposes only lookup operations, so a caller can describe actions without
 * acquiring registration or dispatch authority.
 */
export type IActionManagerReader = Pick<IActionManager, 'getAction' | 'listActions'>;

