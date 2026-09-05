export interface TerminalResult {
  success: boolean;
  output: string;
  exitCode: number | null;
}

export interface TerminalExecutor {
  execute(command: string, answers: string[], cwd?: string, timeout?: number): Promise<TerminalResult>;
}