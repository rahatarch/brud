import * as vscode from 'vscode';
import path from 'path';
import { FileOperation } from '../types/patch';
import { validateWorkspacePath } from '../utils/workspacePath';

/**
 * Executes an array of FileOperation objects sequentially.
 *
 * @param operations - An array of parsed FileOperation objects to execute in order.
 * @returns A promise that resolves with an object containing:
 *   - success: Whether all or some operations succeeded.
 *   - message: A summary message describing the result.
 *   - errors: An array of error messages collected during execution.
 */
export async function executeFileOperations(
  operations: FileOperation[],
): Promise<{ success: boolean; message: string; errors: string[] }> {
  if (operations.length === 0) {
    return { success: false, message: 'No operations to execute.', errors: ['No operations to execute.'] };
  }

  const errors: string[] = [];

  for (const operation of operations) {
    try {
      switch (operation.kind) {
        case 'search_replace': {
          const result = validateWorkspacePath(operation.path);
          if (!result.valid) {
            errors.push(result.error);
            continue;
          }

          const uri = result.uri;
          const fileData = await vscode.workspace.fs.readFile(uri);
          const content = Buffer.from(fileData).toString('utf8');

          let count = 0;
          let searchIndex = content.indexOf(operation.search);
          while (searchIndex !== -1) {
            count++;
            searchIndex = content.indexOf(operation.search, searchIndex + 1);
          }

          if (count === 0) {
            errors.push(`Search text not found in file: ${operation.path}`);
            continue;
          }

          if (count > 1) {
            errors.push(`Multiple matches found for search text in file: ${operation.path}. Please provide more context to make the search unique.`);
            continue;
          }

          const matchIndex = content.indexOf(operation.search);
          const updatedContent = content.substring(0, matchIndex) + operation.replace + content.substring(matchIndex + operation.search.length);
          await vscode.workspace.fs.writeFile(uri, Buffer.from(updatedContent, 'utf8'));
          break;
        }

        case 'create_file': {
          const result = validateWorkspacePath(operation.path);
          if (!result.valid) {
            errors.push(result.error);
            continue;
          }

          const uri = result.uri;

          try {
            await vscode.workspace.fs.stat(uri);
            errors.push(`File already exists: ${operation.path}`);
            continue;
          } catch {
            // File does not exist, proceed with creation
          }

          const parentDir = uri.with({ path: path.dirname(uri.path) });
          await vscode.workspace.fs.createDirectory(parentDir);
          await vscode.workspace.fs.writeFile(uri, Buffer.from(operation.content, 'utf8'));
          break;
        }

        case 'delete_file': {
          const result = validateWorkspacePath(operation.path);
          if (!result.valid) {
            errors.push(result.error);
            continue;
          }

          const uri = result.uri;

          try {
            await vscode.workspace.fs.stat(uri);
          } catch {
            errors.push(`File not found: ${operation.path}`);
            continue;
          }

          await vscode.workspace.fs.delete(uri);
          break;
        }

        case 'rename_file': {
          const fromResult = validateWorkspacePath(operation.from);
          if (!fromResult.valid) {
            errors.push(fromResult.error);
            continue;
          }

          const toResult = validateWorkspacePath(operation.to);
          if (!toResult.valid) {
            errors.push(toResult.error);
            continue;
          }

          const sourceUri = fromResult.uri;
          const targetUri = toResult.uri;

          try {
            await vscode.workspace.fs.stat(sourceUri);
          } catch {
            errors.push(`Source file not found: ${operation.from}`);
            continue;
          }

          try {
            await vscode.workspace.fs.stat(targetUri);
            errors.push(`Destination file already exists: ${operation.to}`);
            continue;
          } catch {
            // Destination does not exist, proceed with rename
          }

          await vscode.workspace.fs.rename(sourceUri, targetUri);
          break;
        }

        case 'move_file': {
          const fromResult = validateWorkspacePath(operation.from);
          if (!fromResult.valid) {
            errors.push(fromResult.error);
            continue;
          }

          const toResult = validateWorkspacePath(operation.to);
          if (!toResult.valid) {
            errors.push(toResult.error);
            continue;
          }

          const sourceUri = fromResult.uri;
          const targetUri = toResult.uri;

          try {
            await vscode.workspace.fs.stat(sourceUri);
          } catch {
            errors.push(`Source file not found: ${operation.from}`);
            continue;
          }

          try {
            await vscode.workspace.fs.stat(targetUri);
            errors.push(`Destination file already exists: ${operation.to}`);
            continue;
          } catch {
            // Destination does not exist, proceed with move
          }

          const parentDir = targetUri.with({ path: path.dirname(targetUri.path) });
          await vscode.workspace.fs.createDirectory(parentDir);
          await vscode.workspace.fs.rename(sourceUri, targetUri);
          break;
        }

        case 'copy_file': {
          const fromResult = validateWorkspacePath(operation.from);
          if (!fromResult.valid) {
            errors.push(fromResult.error);
            continue;
          }

          const toResult = validateWorkspacePath(operation.to);
          if (!toResult.valid) {
            errors.push(toResult.error);
            continue;
          }

          const sourceUri = fromResult.uri;
          const targetUri = toResult.uri;

          try {
            await vscode.workspace.fs.stat(sourceUri);
          } catch {
            errors.push(`Source file not found: ${operation.from}`);
            continue;
          }

          try {
            await vscode.workspace.fs.stat(targetUri);
            errors.push(`Destination file already exists: ${operation.to}`);
            continue;
          } catch {
            // Destination does not exist, proceed with copy
          }

          const parentDir = targetUri.with({ path: path.dirname(targetUri.path) });
          await vscode.workspace.fs.createDirectory(parentDir);
          await vscode.workspace.fs.copy(sourceUri, targetUri);
          break;
        }

        case 'append_file': {
          const result = validateWorkspacePath(operation.path);
          if (!result.valid) {
            errors.push(result.error);
            continue;
          }

          const uri = result.uri;

          let existingContent = '';
          try {
            const fileData = await vscode.workspace.fs.readFile(uri);
            existingContent = Buffer.from(fileData).toString('utf8');
          } catch {
            errors.push(`File not found: ${operation.path}`);
            continue;
          }

          const updatedContent = operation.position === 'end'
            ? existingContent + operation.content
            : operation.content + existingContent;

          await vscode.workspace.fs.writeFile(uri, Buffer.from(updatedContent, 'utf8'));
          break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Unexpected error during ${operation.kind}: ${message}`);
    }
  }

  const total = operations.length;
  const errorCount = errors.length;
  const successCount = total - errorCount;

  if (errorCount === 0) {
    return { success: true, message: `Successfully executed ${total} file operations.`, errors: [] };
  }

  if (successCount > 0) {
    return {
      success: true,
      message: `Executed ${successCount} of ${total} operations with ${errorCount} errors.`,
      errors,
    };
  }

  return { success: false, message: `All ${total} operations failed.`, errors };
}