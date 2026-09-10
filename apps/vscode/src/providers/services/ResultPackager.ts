import type { OperationResult } from '@brud/protocol';

export interface UnifiedOperation {
  toolKind: string;
  data: any;
}

export interface PackageResultInput {
  operationResults: any[];
  operations: any[];
  structuredData?: any;
}

function toTerminalOperationData(
  operationResults: OperationResult[],
  originalOperations: any[],
): UnifiedOperation[] {
  const result: UnifiedOperation[] = [];
  for (const op of operationResults) {
    if (op.kind !== 'terminal_command' || !op.data) continue;
    if (Array.isArray(op.data)) {
      const originalOp = originalOperations[op.operationIndex] as any;
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
      const succeeded = op.data.filter((d: any) => d.success).length;
      const failed = op.data.filter((d: any) => !d.success).length;
      const totalDuration = op.data.reduce((sum: number, d: any) => sum + (d.duration || 0), 0);
      result.push({
        toolKind: 'terminal_command',
        data: {
          mode,
          results: op.data,
          totalDuration,
          succeeded,
          failed,
        },
      });
    } else {
      result.push({ toolKind: 'terminal_command', data: op.data });
    }
  }
  return result;
}

export function packageOperationResults(input: PackageResultInput): UnifiedOperation[] {
  const { operationResults, operations } = input;
  const result: UnifiedOperation[] = [];

  for (const op of operationResults) {
    if (op.kind === 'terminal_command' && op.data) {
      const terminalItems = toTerminalOperationData([op], operations);
      result.push(...terminalItems);
    } else if (op.kind === 'terminal_command' && !op.data) {
      const origOp = operations[op.operationIndex] as any;
      result.push({
        toolKind: 'terminal_command',
        data: {
          command: origOp?.command || (origOp?.commands ? origOp.commands.join(' && ') : op.message || ''),
          output: op.message || '',
          exitCode: null,
          duration: 0,
          success: false,
        },
      });
    } else {
      result.push({ toolKind: op.kind, data: op });
    }
  }

  return result;
}

export function extractStructuredData(message: string): any | null {
  try {
    const parsed = JSON.parse(message);
    if (parsed && parsed.combined) {
      return parsed.combined;
    }
    return parsed;
  } catch {
    return null;
  }
}