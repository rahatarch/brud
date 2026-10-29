import type {
  ITerminalService,
  TerminalChunkCallback,
  TerminalPolicy,
} from '@brud/kernel' with { 'resolution-mode': 'import' };
import { bindTerminalService, getBoundTerminalService, terminalAuthority } from './binding';
import {
  executeCommand,
  executeSequential,
  executeParallel,
  executeConditional,
  executeTerminalCommand,
} from './executor';
import type { TerminalExecutor } from './types';

/**
 * Legacy terminal authority binding.
 *
 * The legacy executor is a module-level function surface without a kernel
 * handle, while the kernel service lives per kernel instance. Hosts bind the
 * instance here (see `bootCoreKernel`), so `executeCommand`, `killProcess`
 * and `getActiveProcessIds` all delegate to one session registry.
 */

/**
 * Binds the terminal authority every legacy facade call delegates to.
 *
 * @param service - Kernel terminal service registered for this host.
 */
export function bindTerminalAuthority(service: ITerminalService | undefined): void {
  bindTerminalService(service);
}

export { terminalAuthority };
export type { ITerminalService, TerminalPolicy };

/**
 * Reports whether a host bound a terminal authority.
 */
export function hasTerminalAuthority(): boolean {
  return getBoundTerminalService() !== undefined;
}

/**
 * Policy of the bound terminal authority.
 */
export function getTerminalPolicy(): TerminalPolicy {
  return terminalAuthority().getPolicy();
}

/**
 * Builds a `TerminalExecutor` over the bound kernel authority.
 *
 * Chunk callbacks are captured once, exactly like the transport
 * compositions this facade replaces: a caller that passes its own `onChunk`
 * still streams through the captured sink.
 *
 * @param onChunk - Stream receiver bound to the transport.
 */
export function createTerminalExecutor(onChunk?: TerminalChunkCallback): TerminalExecutor {
  return {
    execute: (command, answers, cwd, timeout) =>
      executeTerminalCommand(command, answers, cwd, timeout),
    executeCommand: (command, cwd, timeout, env, _onChunk, signal) =>
      executeCommand(command, cwd, timeout, env, onChunk, signal),
    executeSequential: (commands, cwd, timeout, env, stopOnFailure, _onChunk, signal) =>
      executeSequential(commands, cwd, timeout, env, stopOnFailure, onChunk, signal),
    executeParallel: (commands, cwd, timeout, env, _onChunk, signal) =>
      executeParallel(commands, cwd, timeout, env, onChunk, signal),
    executeConditional: (conditional, cwd, timeout, env, _onChunk, signal) =>
      executeConditional(conditional, cwd, timeout, env, onChunk, signal),
  };
}
