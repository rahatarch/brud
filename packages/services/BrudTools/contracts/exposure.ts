import type { OperationResult } from '@brud/kernel';
import type { IToolDisposable, ListToolsFilter, RegisteredToolInfo, ToolRegistrationOptions } from './IBrudToolsService.js';

/** The exposure BrudTools declares: resolve it with `registry.resolve('brud.tools')`. */
export const BRUD_TOOLS_EXPOSURE = 'brud.tools';

/** Capability that unlocks `registerTool` on the `brud.tools` handle. */
export const TOOLS_REGISTER_CAPABILITY = 'tools:register';

/** Capability that unlocks `executeTool` and `validateTool` on the `brud.tools` handle. */
export const TOOLS_EXECUTE_CAPABILITY = 'tools:execute';

/**
 * The settings exposure BrudTools reads its tool allow-list from. Resolved as
 * BrudTools; when it does not resolve (no settings giver, or not yet running)
 * every tool is allowed, as before.
 */
export const SETTINGS_READER_EXPOSURE = 'brud.settings.reader';

/** Router operation kind BrudTools registers its dispatch under. */
export const BRUD_KIND_TOOL = 'tool' as const;

/** What a caller supplies per call; identity, permissions and origin come from the kernel. */
export interface ToolCallOptions {
  /** Workspace root the tool runs against. */
  readonly workspaceRoot: string;
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal;
}

/**
 * The `brud.tools@1` handle a caller receives from `resolve`. The methods
 * present depend on the caller's capabilities: everyone admitted can read;
 * `tools:register` adds `registerTool`; `tools:execute` adds `executeTool` and
 * `validateTool`. A caller with neither capability resolves `null`.
 *
 * The tool's owner, its official status, and the permissions checked against
 * a tool's `requiredPermissions` are the real caller's, taken from the kernel's
 * caller view; a caller cannot claim them.
 */
export interface IBrudToolsApi {
  getTool(name: string): RegisteredToolInfo | undefined;
  listTools(filter?: ListToolsFilter): readonly RegisteredToolInfo[];
  registerTool?(options: ToolRegistrationOptions): IToolDisposable;
  executeTool?(name: string, input: unknown, options: ToolCallOptions): Promise<OperationResult>;
  validateTool?(name: string, input: unknown, options: ToolCallOptions): OperationResult;
}
