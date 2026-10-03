import { ChildProcess } from 'child_process';
import { ChunkCallback } from './types';

interface RegisteredProcess {
  processId: string;
  child: ChildProcess;
  abortController: AbortController;
  onChunk?: ChunkCallback;
}

let processCounter = 0;
const activeProcesses = new Map<string, RegisteredProcess>();

function generateProcessId(): string {
  processCounter++;
  const now = Date.now();
  return `proc-${now}-${processCounter}`;
}

function forceKillChild(child: ChildProcess): void {
  if (typeof process === 'undefined') return;
  if (child.pid === undefined) {
    try { child.kill('SIGKILL'); } catch {}
    return;
  }
  if (process.platform === 'win32') {
    try {
      const { spawn } = require('child_process');
      spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
    } catch {
      try { child.kill(); } catch {}
    }
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      try { child.kill('SIGKILL'); } catch {}
    }
  }
}

export function registerProcess(
  child: ChildProcess,
  onChunk?: ChunkCallback,
): { processId: string; abortController: AbortController } {
  const processId = generateProcessId();
  const abortController = new AbortController();

  const abortHandler = () => {
    forceKillChild(child);
  };
  abortController.signal.addEventListener('abort', abortHandler, { once: true });

  activeProcesses.set(processId, { processId, child, abortController, onChunk });

  const cleanup = () => {
    activeProcesses.delete(processId);
    try {
      abortController.signal.removeEventListener('abort', abortHandler);
    } catch {}
  };

  child.on('close', cleanup);
  child.on('error', cleanup);

  return { processId, abortController };
}

export function unregisterProcess(processId: string): void {
  activeProcesses.delete(processId);
}

export function killProcess(processId: string): boolean {
  const entry = activeProcesses.get(processId);
  if (!entry) return false;

  try {
    entry.abortController.abort();
  } catch {}
  forceKillChild(entry.child);
  activeProcesses.delete(processId);
  return true;
}

export function killAllProcesses(): number {
  let count = 0;
  for (const [processId] of activeProcesses) {
    if (killProcess(processId)) count++;
  }
  return count;
}

export function getActiveProcessIds(): string[] {
  return Array.from(activeProcesses.keys());
}

export function hasActiveProcess(processId: string): boolean {
  return activeProcesses.has(processId);
}

export function getProcessOnChunk(processId: string): ChunkCallback | undefined {
  return activeProcesses.get(processId)?.onChunk;
}

export { ChunkCallback } from './types';