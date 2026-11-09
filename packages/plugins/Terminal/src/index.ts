export { createTerminalPlugin, plugin } from './plugin.js';
export { manifest } from './manifest.js';
export { TERMINAL_COMMAND_SCHEMA, createTerminalCommandRequest, terminalCommand } from './groups/terminalCommand/index.js';
export { TERMINAL_INTERACTIVE_SCHEMA, createTerminalInteractiveRequest, terminalInteractive } from './groups/terminalInteractive/index.js';
export {
  TERMINAL_KILL_PROCESS_ACTION,
  TERMINAL_KILL_PROCESS_SCHEMA,
  TERMINAL_LIST_PROCESSES_ACTION,
  TERMINAL_LIST_PROCESSES_SCHEMA,
  terminalKillProcess,
  terminalListProcesses,
} from './groups/terminalActions/index.js';
export type { TerminalProcessInfo } from './groups/terminalActions/index.js';
export type {
  TerminalCommandData,
  TerminalFailureCode,
  TerminalFailureData,
  TerminalOperationResult,
  TerminalToolErrorOptions,
} from './groups/shared/index.js';
export { TerminalToolError } from './groups/shared/index.js';
export { plugin as default } from './plugin.js';