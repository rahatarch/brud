import type { ExposedApiCaller } from '@brud/kernel';
import type { IBrudToolsService, IPluginExecutionContext } from '../contracts/IBrudToolsService.js';
import {
  TOOLS_EXECUTE_CAPABILITY,
  TOOLS_REGISTER_CAPABILITY,
  type IBrudToolsApi,
  type ToolCallOptions,
} from '../contracts/exposure.js';

/** The caller's stable id: its kernel-issued identity, or its class for identity-less callers. */
function callerIdOf(caller: ExposedApiCaller): string {
  return caller.identity ?? caller.callerClass;
}

/**
 * Builds the `brud.tools@1` handle for one caller (the exposure's Layer 2
 * projection). The facade is shaped by the caller's capabilities, and every
 * piece of identity the service records or checks comes from the kernel's
 * caller view, never from the caller's arguments.
 *
 * @param service - The BrudTools service.
 * @param caller - The real caller's view, captured at resolve time.
 * @returns The handle, or `null` when the caller holds neither tools capability.
 */
export function toolsFacade(service: IBrudToolsService, caller: ExposedApiCaller): IBrudToolsApi | null {
  const canRegister = caller.capabilities.has(TOOLS_REGISTER_CAPABILITY);
  const canExecute = caller.capabilities.has(TOOLS_EXECUTE_CAPABILITY);

  if (!canRegister && !canExecute) {
    return null;
  }

  const contextFor = (options: ToolCallOptions): IPluginExecutionContext => {
    if (options === null || typeof options !== 'object' || typeof options.workspaceRoot !== 'string') {
      throw new TypeError('brud.tools: options.workspaceRoot must be a string');
    }

    return {
      workspaceRoot: options.workspaceRoot,
      callerId: callerIdOf(caller),
      permissions: [...caller.capabilities].sort(),
      origin: caller.origin,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    };
  };

  const facade: IBrudToolsApi = {
    getTool: (name) => service.getTool(name),
    listTools: (filter) => service.listTools(filter),
    ...(canRegister
      ? { registerTool: (options) => service.registerTool(callerIdOf(caller), caller.official, options) }
      : {}),
    ...(canExecute
      ? {
        executeTool: (name, input, options) => service.executeTool(name, input, contextFor(options)),
        validateTool: (name, input, options) => service.validateTool(name, input, contextFor(options)),
      }
      : {}),
  };

  return Object.freeze(facade);
}
