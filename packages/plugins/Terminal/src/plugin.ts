import type { IBrudPlugin, IPluginContext } from '@brud/kernel';
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

      context.logger.info('Terminal tools registered', {
        tools: ['terminal_command', 'terminal_interactive'],
      });
    },
  };
}

/** Shared Terminal plugin instance. */
export const plugin: IBrudPlugin = createTerminalPlugin();

export default plugin;