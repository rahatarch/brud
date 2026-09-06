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

export interface TerminalExecutor {
  execute(command: string, answers: string[], cwd?: string, timeout?: number): Promise<TerminalResult>;
  executeCommand(command: string, cwd?: string, timeout?: number, env?: Record<string, string>): Promise<TerminalResult>;
}