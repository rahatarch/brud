export interface TerminalResultData {
  command: string;
  output: string;
  exitCode: number | null;
  duration: number;
  success: boolean;
}

export interface TerminalGroupData {
  mode: 'single' | 'sequential' | 'parallel' | 'conditional';
  results: TerminalResultData[];
  totalDuration: number;
  succeeded: number;
  failed: number;
}

export function transformTerminalOperation(
  operation: { kind?: string; data?: any; operationIndex?: number },
  originalOperations: any[],
): TerminalGroupData | TerminalResultData | null {
  if (operation.kind !== 'terminal_command' || !operation.data) {
    return null;
  }

  if (Array.isArray(operation.data)) {
    const originalOp = originalOperations[operation.operationIndex ?? -1];
    let mode: 'single' | 'sequential' | 'parallel' | 'conditional' = 'sequential';
    if (originalOp) {
      if (originalOp.mode === 'parallel') {
        mode = 'parallel';
      } else if (originalOp.onSuccess || originalOp.onFailure) {
        mode = 'conditional';
      } else {
        mode = 'sequential';
      }
    }
    const succeeded = operation.data.filter((d: any) => d.success).length;
    const failed = operation.data.filter((d: any) => !d.success).length;
    const totalDuration = operation.data.reduce((sum: number, d: any) => sum + (d.duration || 0), 0);
    return {
      mode,
      results: operation.data,
      totalDuration,
      succeeded,
      failed,
    };
  }

  return operation.data as TerminalResultData;
}

export function buildFailedTerminalData(op: any, originalOp: any): TerminalResultData {
  return {
    command: originalOp?.command || (originalOp?.commands ? originalOp.commands.join(' && ') : op.message || ''),
    output: op.message || '',
    exitCode: null,
    duration: 0,
    success: false,
  };
}