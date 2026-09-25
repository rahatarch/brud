import type { PackageResultInput, UnifiedOperation } from '@brud/protocol';
import { transformTerminalOperation, buildFailedTerminalData } from '../terminal/terminalResultFormatter';

export const READ_SUCCESS_KINDS = new Set([
  'read_file',
  'read_files',
  'read_directory',
  'extract_structure',
  'codebase_metadata',
  'search_files',
  'get_tool_info',
]);

export function extractStructuredData(message: string): unknown {
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

export function packageOperationResults(
  operationResults: any[],
  operations: any[],
): PackageResultInput {
  const unifiedOps: UnifiedOperation[] = [];

  for (const op of operationResults) {
    if (op.kind === 'terminal_command') {
      const transformed = transformTerminalOperation(op, operations);
      if (transformed) {
        unifiedOps.push({
          kind: 'terminal_command',
          filePath: '',
          success: true,
          message: 'Terminal command executed',
          details: transformed,
        });
      } else {
        const origOp = operations[op.operationIndex] as any;
        const failedData = buildFailedTerminalData(op, origOp);
        unifiedOps.push({
          kind: 'terminal_command',
          filePath: '',
          success: false,
          message: failedData.output,
          details: failedData,
        });
      }
    } else {
      const success = op.status === 'success' || op.status === 'completed';
      unifiedOps.push({
        kind: op.kind,
        filePath: op.path || '',
        success,
        message: op.message || '',
        details: op,
      });
    }
  }

  const totalOperations = unifiedOps.length;
  const successfulOperations = unifiedOps.filter(o => o.success).length;
  const failedOperations = unifiedOps.filter(o => !o.success).length;

  let status: 'success' | 'failure' | 'partial';
  let summary: string;

  if (failedOperations === 0) {
    status = 'success';
    summary = `All ${totalOperations} operation(s) completed successfully.`;
  } else if (successfulOperations === 0) {
    status = 'failure';
    summary = `All ${totalOperations} operation(s) failed.`;
  } else {
    status = 'partial';
    summary = `${successfulOperations} of ${totalOperations} operation(s) succeeded, ${failedOperations} failed.`;
  }

  return {
    operations: unifiedOps,
    totalOperations,
    successfulOperations,
    failedOperations,
    status,
    summary,
  };
}