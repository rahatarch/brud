import type { FileOperation } from '@brud/core';
import type { OperationResult } from '@brud/protocol';
import { transformTerminalOperation, buildFailedTerminalData } from './TerminalDataAdapter';
import type { TerminalGroupData, TerminalResultData } from './TerminalDataAdapter';

export interface UnifiedOperation {
  toolKind: string;
  data: unknown;
}

export interface PackageResultInput {
  operationResults: OperationResult[];
  operations: FileOperation[];
  structuredData?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function packageOperationResults(input: PackageResultInput): UnifiedOperation[] {
  const { operationResults, operations } = input;
  const result: UnifiedOperation[] = [];

  for (const op of operationResults) {
    if (op.kind === 'terminal_command') {
      const transformed: TerminalGroupData | TerminalResultData | null = transformTerminalOperation(op, operations);
      if (transformed) {
        result.push({ toolKind: 'terminal_command', data: transformed });
      } else {
        const origOp = op.operationIndex === undefined ? undefined : operations[op.operationIndex];
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

export function extractStructuredData(message: string): unknown {
  try {
    const parsed: unknown = JSON.parse(message);
    if (isRecord(parsed) && parsed.combined !== undefined) {
      return parsed.combined;
    }
    return parsed;
  } catch {
    return null;
  }
}
