import type { FileOperation } from '@brud/core';
import type { OperationResult } from '@brud/protocol';

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

interface DiagnosticFields {
  code?: string;
  details?: string;
  status?: string;
}

function getDiagnostics(operation: Pick<OperationResult, 'code' | 'details' | 'status'>): DiagnosticFields {
  return {
    ...(operation.code ? { code: operation.code } : {}),
    ...(operation.details ? { details: operation.details } : {}),
    ...(operation.status ? { status: operation.status } : {}),
  };
}

function getOriginalCommand(originalOp?: FileOperation): string {
  if (!originalOp) {
    return '';
  }
  if ('command' in originalOp) {
    return originalOp.command;
  }
  if ('commands' in originalOp) {
    const commands = originalOp.commands;
    if (Array.isArray(commands)) {
      return commands.filter((item): item is string => typeof item === 'string').join(' && ');
    }
  }
  return '';
}

export function transformTerminalOperation(
  operation: Pick<OperationResult, 'kind' | 'data' | 'operationIndex' | 'code' | 'details' | 'status'>,
  originalOperations: FileOperation[],
): TerminalGroupData | TerminalResultData | null {
  if (operation.kind !== 'terminal_command' || !operation.data) {
    return null;
  }

  const diagnostics = getDiagnostics(operation);

  if (Array.isArray(operation.data)) {
    const originalOp = operation.operationIndex === undefined ? undefined : originalOperations[operation.operationIndex];
    let mode: TerminalGroupData['mode'] = 'sequential';
    if (originalOp && 'mode' in originalOp && originalOp.mode === 'parallel') {
      mode = 'parallel';
    } else if (originalOp && 'onSuccess' in originalOp && (originalOp.onSuccess || ('onFailure' in originalOp && originalOp.onFailure))) {
      mode = 'conditional';
    }

    const succeeded = operation.data.filter((item) => item.success).length;
    const failed = operation.data.filter((item) => !item.success).length;
    const totalDuration = operation.data.reduce((sum, item) => sum + (item.duration || 0), 0);
    let diagnosticsAttached = false;
    const results = operation.data.map((item) => {
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

  return { ...operation.data, ...diagnostics };
}

export function buildFailedTerminalData(
  op: Pick<OperationResult, 'message' | 'code' | 'details' | 'status'>,
  originalOp?: FileOperation,
): TerminalResultData {
  return {
    command: getOriginalCommand(originalOp) || op.message || '',
    output: '',
    exitCode: null,
    duration: 0,
    success: false,
    ...getDiagnostics(op),
  };
}
