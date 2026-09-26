import { parseOperations, executeFileOperations, type FileOperationResult } from '@brud/core';
import { NodeFileSystem } from '../filesystem/nodeFileSystem.js';

export async function executeBrudBlock(blockText: string, workspaceRoot: string): Promise<string> {
  const operations = parseOperations(blockText, [workspaceRoot]);
  const fs = new NodeFileSystem();
  const result: FileOperationResult = await executeFileOperations(operations, fs, [workspaceRoot]);
  return formatResult(result);
}

function formatResult(result: FileOperationResult): string {
  const lines: string[] = [];
  const plural = result.operationResults.length !== 1 ? 's' : '';
  lines.push(`Executed ${result.operationResults.length} operation${plural}. Overall status: ${result.success ? 'PASS' : 'FAIL'}`);

  if (result.errors.length > 0) {
    lines.push(`Errors: ${result.errors.length}`);
    for (const err of result.errors) {
      lines.push(`  - [${err.code}] ${err.details ?? err.friendly}`);
    }
  }

  for (const op of result.operationResults) {
    const statusLabel = op.status === 'success' ? 'PASS' : op.status === 'aborted' ? 'ABORTED' : 'FAIL';
    const target = op.path || op.directoryPath || op.from || '';
    lines.push(`[${statusLabel}] ${op.kind}${target ? ` — ${target}` : ''}`);

    if (op.from && op.to) {
      lines.push(`  from: ${op.from} -> to: ${op.to}`);
    }

    if (op.kind === 'read_file' && op.status === 'success') {
      try {
        const parsed = JSON.parse(op.message);
        if (parsed.files && Array.isArray(parsed.files)) {
          for (const file of parsed.files) {
            lines.push(`  File: ${file.path}`);
            lines.push(`  Content:\n${file.content}`);
          }
        } else {
          lines.push(`  Result: ${op.message}`);
        }
      } catch {
        lines.push(`  Result: ${op.message}`);
      }
    } else {
      const trimmed = op.message.length > 500 ? op.message.substring(0, 500) + '...' : op.message;
      if (trimmed) {
        lines.push(`  ${trimmed}`);
      }
    }
  }

  return lines.join('\n');
}