import type { IBrudPlugin, IPluginContext } from '@brud/service-plugin-manager';
import {
  TERMINAL_KILL_PROCESS_ACTION,
  TERMINAL_KILL_PROCESS_SCHEMA,
  TERMINAL_LIST_PROCESSES_ACTION,
  TERMINAL_LIST_PROCESSES_SCHEMA,
  terminalKillProcess,
  terminalListProcesses,
} from './groups/terminalActions/index.js';
import { TERMINAL_COMMAND_SCHEMA, terminalCommand } from './groups/terminalCommand/index.js';
import { TERMINAL_INTERACTIVE_SCHEMA, terminalInteractive } from './groups/terminalInteractive/index.js';
import { manifest } from './manifest.js';

/**
 * Builds the Terminal plugin.
 *
 * Every activation resolves one scoped `ITerminalHandle` and captures it in
 * the two tool handlers. A kernel composition without `brud.core.terminal`
 * (or without the declared `terminal:execute` permission) yields `null`; the
 * plugin then logs a warning and registers nothing instead of failing boot.
 */
export function createTerminalPlugin(): IBrudPlugin {
  return {
    manifest,
    activate(context: IPluginContext): void {
      const terminal = context.getTerminal();

      if (terminal === null) {
        context.logger.warn(
          'Terminal execution is unavailable; terminal_command and terminal_interactive were not registered.',
          { pluginId: context.pluginId },
        );

        return;
      }

      context.registerTool({
        name: 'terminal_command',
        description: 'Run terminal commands — single, sequential, parallel, or conditional',
        parametersSchema: TERMINAL_COMMAND_SCHEMA,
        execute: (input, executionContext) =>
          terminalCommand(input, terminal, executionContext),
      });

      context.registerTool({
        name: 'terminal_interactive',
        description: 'Run terminal commands with interactive prompt support',
        parametersSchema: TERMINAL_INTERACTIVE_SCHEMA,
        execute: (input, executionContext) =>
          terminalInteractive(input, terminal, executionContext),
      });

      context.registerAction({
        name: TERMINAL_KILL_PROCESS_ACTION,
        description: 'Terminate a live terminal process started by this plugin',
        parametersSchema: TERMINAL_KILL_PROCESS_SCHEMA,
        execute: (input, executionContext) =>
          terminalKillProcess(input, terminal, executionContext),
      });

      context.registerAction({
        name: TERMINAL_LIST_PROCESSES_ACTION,
        description: 'List live terminal processes started by this plugin',
        parametersSchema: TERMINAL_LIST_PROCESSES_SCHEMA,
        execute: (input, executionContext) =>
          terminalListProcesses(input, terminal, executionContext),
      });

      context.logger.info('Terminal tools and actions registered', {
        tools: ['terminal_command', 'terminal_interactive'],
        actions: [TERMINAL_KILL_PROCESS_ACTION, TERMINAL_LIST_PROCESSES_ACTION],
      });
    },
  };
}

/** Shared Terminal plugin instance. */
export const plugin: IBrudPlugin = createTerminalPlugin();

export default plugin;