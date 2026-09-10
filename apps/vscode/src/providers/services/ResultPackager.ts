import type { OperationResult } from '@brud/protocol';
import { transformTerminalOperation, buildFailedTerminalData } from './TerminalDataAdapter';

export interface UnifiedOperation {
  toolKind: string;
  data: any;
}

export interface PackageResultInput {
  operationResults: any[];
  operations: any[];
  structuredData?: any;
}

export function packageOperationResults(input: PackageResultInput): UnifiedOperation[] {
  const { operationResults, operations } = input;
  const result: UnifiedOperation[] = [];

  for (const op of operationResults) {
    if (op.kind === 'terminal_command') {
      const transformed = transformTerminalOperation(op, operations);
      if (transformed) {
        result.push({ toolKind: 'terminal_command', data: transformed });
      } else {
        const origOp = operations[op.operationIndex] as any;
        result.push({
          toolKind: 'terminal_command',
          data: buildFailedTerminalData(op, origOp),
        });
      }
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