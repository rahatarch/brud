import { ChildProcess } from 'child_process';

export type TerminalStatus = 'success' | 'failed' | 'interrupted';

export interface TerminalResult {
  success: boolean;
  output: string;
  exitCode: number | null;
  duration: number;
  status: TerminalStatus;
}

export interface TerminalCommand {
  command: string;
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
  raw?: boolean;
}

export interface CommandGroup {
  type: 'sequential' | 'parallel';
  commands: (string | CommandGroup)[];
  stopOnFailure?: boolean;
}

export interface ConditionalCommand {
  command: string;
  onSuccess?: CommandGroup;
  onFailure?: CommandGroup;
}

export interface ExecutedCommand {
  command: string;
  success: boolean;
  output: string;
  exitCode: number | null;
  duration: number;
  status: TerminalStatus;
}

export interface GroupResult {
  success: boolean;
  results: ExecutedCommand[];
  totalDuration: number;
}

export type ChunkCallback = (chunk: string, chunkIndex: number) => void;

export interface ExecuteOptions {
  command: string;
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
  onChunk?: ChunkCallback;
  signal?: AbortSignal;
}

export interface TerminalExecutor {
  execute(command: string, answers: string[], cwd?: string, timeout?: number): Promise<TerminalResult>;
  executeCommand(command: string, cwd?: string, timeout?: number, env?: Record<string, string>, onChunk?: ChunkCallback, signal?: AbortSignal): Promise<TerminalResult>;
  executeSequential(commands: string[], cwd?: string, timeout?: number, env?: Record<string, string>, stopOnFailure?: boolean, onChunk?: ChunkCallback, signal?: AbortSignal): Promise<GroupResult>;
  executeParallel(commands: string[], cwd?: string, timeout?: number, env?: Record<string, string>, onChunk?: ChunkCallback, signal?: AbortSignal): Promise<GroupResult>;
  executeConditional(conditional: ConditionalCommand, cwd?: string, timeout?: number, env?: Record<string, string>, onChunk?: ChunkCallback, signal?: AbortSignal): Promise<GroupResult>;
}