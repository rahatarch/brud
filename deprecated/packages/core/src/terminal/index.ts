export * from './types';
export { executeTerminalCommand, executeCommand, executeSequential, executeParallel, executeConditional, executeCommandGroup } from './executor';
export { registerProcess, unregisterProcess, killProcess, killAllProcesses, getActiveProcessIds, hasActiveProcess, getProcessOnChunk } from './streamer';
export {
  bindTerminalAuthority,
  createTerminalExecutor,
  getTerminalPolicy,
  hasTerminalAuthority,
  terminalAuthority,
} from './bridge';
export type { ITerminalService, TerminalPolicy } from './bridge';
