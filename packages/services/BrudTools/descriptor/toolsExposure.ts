import type { ExposedApiCaller } from '@brud/kernel';
import { byCapability } from '@brud/sdk/participant';
import type { IPluginExecutionContext, ToolRegistrationOptions } from '../contracts/IBrudToolsService.js';
import type { ListToolsFilter } from '../contracts/filters.js';
import { TOOLS_EXECUTE_CAPABILITY, TOOLS_REGISTER_CAPABILITY, type ToolCallOptions } from '../contracts/exposure.js';
import type { BrudToolsService } from '../orchestrator/index.js';

/** The caller's kernel-issued identity. A tool owner must have one; a caller without one is refused. */
function ownerIdOf(caller: ExposedApiCaller): string {
  if (caller.identity === null) {
    throw new Error(`Tool registration requires a kernel-issued identity (caller class "${caller.callerClass}")`);
  }

  return caller.identity;
}

/** The caller's stable id for execution: its identity, or `host` for the host session, which has none. */
function callerIdOf(caller: ExposedApiCaller): string {
  if (caller.identity !== null) {
    return caller.identity;
  }

  if (caller.callerClass === 'host') {
    return caller.callerClass;
  }

  throw new Error(`A ${caller.callerClass} caller needs a kernel-issued identity`);
}

/** Execution context for one call: identity, permissions and origin from the kernel's caller view. */
function contextFor(caller: ExposedApiCaller, options: ToolCallOptions = {}): IPluginExecutionContext {
  return {
    callerId: callerIdOf(caller),
    permissions: [...caller.capabilities].sort(),
    origin: caller.origin,
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
  };
}

/**
 * The `brud.tools@1` handle: `tools:register` adds `registerTool`;
 * `tools:execute` adds `executeTool` and `validateTool`; either adds the read
 * methods; neither refuses (`null`). Owner, officialness and permissions are
 * the real caller's, never the caller's arguments.
 */
export const toolsHandle = byCapability<BrudToolsService>(
  {
    [TOOLS_REGISTER_CAPABILITY]: (ctx, caller) => ({
      registerTool: (options: ToolRegistrationOptions) => ctx.instance.registerTool(ownerIdOf(caller), caller.official, options, caller.identity ?? undefined),
    }),
    [TOOLS_EXECUTE_CAPABILITY]: (ctx, caller) => ({
      executeTool: (name: string, input: unknown, options?: ToolCallOptions) => ctx.instance.executeTool(name, input, contextFor(caller, options)),
      validateTool: (name: string, input: unknown, options: ToolCallOptions) => ctx.instance.validateTool(name, input, contextFor(caller, options)),
    }),
  },
  {
    shared: (ctx) => ({
      getTool: (name: string) => ctx.instance.getTool(name),
      listTools: (filter?: ListToolsFilter) => ctx.instance.listTools(filter),
    }),
  },
);
