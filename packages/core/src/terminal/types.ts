export interface TerminalResult {
  success: boolean;
  output: string;
  exitCode: number | null;
  duration: number;
}

export interface TerminalCommand {
  command: string;
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
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
}

export interface GroupResult {
  success: boolean;
  results: ExecutedCommand[];
  totalDuration: number;
}

export interface TerminalExecutor {
  execute(command: string, answers: string[], cwd?: string, timeout?: number): Promise<TerminalResult>;
  executeCommand(command: string, cwd?: string, timeout?: number, env?: Record<string, string>): Promise<TerminalResult>;
  executeSequential(commands: string[], cwd?: string, timeout?: number, env?: Record<string, string>, stopOnFailure?: boolean): Promise<GroupResult>;
  executeParallel(commands: string[], cwd?: string, timeout?: number, env?: Record<string, string>): Promise<GroupResult>;
  executeConditional(conditional: ConditionalCommand, cwd?: string, timeout?: number, env?: Record<string, string>): Promise<GroupResult>;
}