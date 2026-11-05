import type { ChildProcess } from 'child_process';
import type { ChunkCallback } from './types';
import { terminalAuthority } from './binding';

/**
 * Legacy process registry facade over the kernel session registry.
 *
 * The legacy signatures are frozen because the VS Code coordinator and the
 * execution handler depend on them. Registration now records into
 * `brud.core.terminal`, so `getActiveProcessIds` on the UI side sees the
 * sessions the executor registered, and `killProcess` reaches them through
 * the kernel's process manager.
 */

/**
 * Registers a child spawned outside the kernel.
 *
 * @param child - Spawned child process.
 * @param onChunk - Stream receiver of the session.
 */
export function registerProcess(
  child: ChildProcess,
  onChunk?: ChunkCallback,
): { processId: string; abortController: AbortController } {
  const service = terminalAuthority();
  const processId = service.registerChild(child, onChunk);

  return { processId, abortController: new AbortController() };
}

/**
 * Detaches a session from the registry without killing it.
 *
 * @param processId - Session id.
 */
export function unregisterProcess(processId: string): void {
  terminalAuthority().unregister(processId);
}

/**
 * Kills one registered session.
 *
 * @param processId - Session id.
 */
export function killProcess(processId: string): boolean {
  return terminalAuthority().kill(processId);
}

/**
 * Kills every registered session.
 */
export function killAllProcesses(): number {
  return terminalAuthority().killAll();
}

/** Registered session ids, in creation order. */
export function getActiveProcessIds(): string[] {
  return terminalAuthority().activeSessions().map((session) => session.processId);
}

/**
 * Reports whether a session id is registered.
 *
 * @param processId - Session id.
 */
export function hasActiveProcess(processId: string): boolean {
  return terminalAuthority().hasSession(processId);
}

/**
 * Stream receiver of one session.
 *
 * @param processId - Session id.
 */
export function getProcessOnChunk(processId: string): ChunkCallback | undefined {
  return terminalAuthority().chunkCallback(processId);
}

export type { ChunkCallback } from './types';
