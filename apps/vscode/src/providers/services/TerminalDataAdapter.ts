export interface TerminalResultData {
  command: string;
  output: string;
  exitCode: number | null;
  duration: number;
  success: boolean;
  code?: string;
  details?: string;
  status?: string;
}

export interface TerminalGroupData {
  mode: 'single' | 'sequential' | 'parallel' | 'conditional';
  results: TerminalResultData[];
  totalDuration: number;
  succeeded: number;
  failed: number;
}

export function transformTerminalOperation(
  operation: { kind?: string; data?: any; operationIndex?: number; code?: string; details?: string; status?: string },
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
    const diagnostics = {
      ...(operation.code ? { code: operation.code } : {}),
      ...(operation.details ? { details: operation.details } : {}),
      ...(operation.status ? { status: operation.status } : {}),
    };
    let diagnosticsAttached = false;
    const results = operation.data.map((item: any) => {
      if (!item.success && !diagnosticsAttached && Object.keys(diagnostics).length > 0) {
        diagnosticsAttached = true;
        return { ...item, ...diagnostics };
      }
      return item;
    });
    return {
      mode,
      results,
      totalDuration,
      succeeded,
      failed,
    };
  }

  const diagnostics = {
    ...(operation.code ? { code: operation.code } : {}),
    ...(operation.details ? { details: operation.details } : {}),
    ...(operation.status ? { status: operation.status } : {}),
  };
  return { ...operation.data, ...diagnostics } as TerminalResultData;
}

export function buildFailedTerminalData(op: any, originalOp: any): TerminalResultData {
  return {
    command: originalOp?.command || (originalOp?.commands ? originalOp.commands.join(' && ') : op.message || ''),
    output: '',
    exitCode: null,
    duration: 0,
    success: false,
    ...(op.code ? { code: op.code } : {}),
    ...(op.details ? { details: op.details } : {}),
    ...(op.status ? { status: op.status } : {}),
  };
}