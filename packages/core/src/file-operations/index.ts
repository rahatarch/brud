import path from 'path';
import { FileOperation } from '../types/patch';
import { FileSystem } from '../types/filesystem';
import { validateWorkspacePath } from '../utils/workspacePath';
import { extractDirectoryStructure } from '../structure-extractor';
import { extractCodebaseMetadata } from '../metadata-extractor';
import type { HistoryStore, SnapshotData } from '../history/index.js';
import { createSnapshot, recordAndSaveSession, generateSessionId } from '../history/index.js';

export async function executeFileOperations(
  operations: FileOperation[],
  fs: FileSystem,
  workspaceFolders: string[],
  historyStore?: HistoryStore,
  originalPrompt?: string,
): Promise<{ success: boolean; message: string; errors: string[] }> {
  if (operations.length === 0) {
    return { success: false, message: 'No operations to execute.', errors: ['No operations to execute.'] };
  }

  const errors: string[] = [];
  const extractionResults: { directoryPath: string; depth: number; json: string; fileCount: number; directoryCount: number }[] = [];

  let filesAffected: string[] = [];
  let sessionId: string | undefined;
  let preSnapshot: SnapshotData | undefined;

  if (historyStore) {
    for (const operation of operations) {
      switch (operation.kind) {
        case 'search_replace':
        case 'create_file':
        case 'delete_file':
        case 'append_file':
          if (!filesAffected.includes(operation.path)) {
            filesAffected.push(operation.path);
          }
          break;
        case 'rename_file':
        case 'move_file':
        case 'copy_file':
          if (!filesAffected.includes(operation.from)) {
            filesAffected.push(operation.from);
          }
          if (!filesAffected.includes(operation.to)) {
            filesAffected.push(operation.to);
          }
          break;
      }
    }

    const now = new Date();
    const seq = 1;
    sessionId = generateSessionId(now, seq);
    preSnapshot = await createSnapshot(sessionId, 'pre', fs, filesAffected);
  }

  for (const operation of operations) {
    try {
      switch (operation.kind) {
        case 'search_replace': {
          const result = validateWorkspacePath(operation.path, workspaceFolders);
          if (!result.valid) {
            errors.push(result.error);
            continue;
          }

          const filePath = result.resolvedPath;
          const content = await fs.readFile(filePath);

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
          await fs.writeFile(filePath, updatedContent);
          break;
        }

        case 'create_file': {
          const result = validateWorkspacePath(operation.path, workspaceFolders);
          if (!result.valid) {
            errors.push(result.error);
            continue;
          }

          const filePath = result.resolvedPath;

          if (await fs.exists(filePath)) {
            errors.push(`File already exists: ${operation.path}`);
            continue;
          }

          const parentDir = path.dirname(filePath);
          await fs.createDirectory(parentDir);
          await fs.writeFile(filePath, operation.content);
          break;
        }

        case 'delete_file': {
          const result = validateWorkspacePath(operation.path, workspaceFolders);
          if (!result.valid) {
            errors.push(result.error);
            continue;
          }

          const filePath = result.resolvedPath;

          if (!(await fs.exists(filePath))) {
            break;
          }

          await fs.deleteFile(filePath);

          if (await fs.exists(filePath)) {
            errors.push(`Failed to delete file: ${operation.path}`);
          }
          break;
        }

        case 'rename_file': {
          const fromResult = validateWorkspacePath(operation.from, workspaceFolders);
          if (!fromResult.valid) {
            errors.push(fromResult.error);
            continue;
          }

          const toResult = validateWorkspacePath(operation.to, workspaceFolders);
          if (!toResult.valid) {
            errors.push(toResult.error);
            continue;
          }

          const sourcePath = fromResult.resolvedPath;
          const targetPath = toResult.resolvedPath;

          if (!(await fs.exists(sourcePath))) {
            errors.push(`Source file not found: ${operation.from}`);
            continue;
          }

          if (await fs.exists(targetPath)) {
            errors.push(`Destination file already exists: ${operation.to}`);
            continue;
          }

          await fs.renameFile(sourcePath, targetPath);
          break;
        }

        case 'move_file': {
          const fromResult = validateWorkspacePath(operation.from, workspaceFolders);
          if (!fromResult.valid) {
            errors.push(fromResult.error);
            continue;
          }

          const toResult = validateWorkspacePath(operation.to, workspaceFolders);
          if (!toResult.valid) {
            errors.push(toResult.error);
            continue;
          }

          const sourcePath = fromResult.resolvedPath;
          const targetPath = toResult.resolvedPath;

          if (!(await fs.exists(sourcePath))) {
            errors.push(`Source file not found: ${operation.from}`);
            continue;
          }

          if (await fs.exists(targetPath)) {
            errors.push(`Destination file already exists: ${operation.to}`);
            continue;
          }

          const parentDir = path.dirname(targetPath);
          await fs.createDirectory(parentDir);
          await fs.renameFile(sourcePath, targetPath);
          break;
        }

        case 'copy_file': {
          const fromResult = validateWorkspacePath(operation.from, workspaceFolders);
          if (!fromResult.valid) {
            errors.push(fromResult.error);
            continue;
          }

          const toResult = validateWorkspacePath(operation.to, workspaceFolders);
          if (!toResult.valid) {
            errors.push(toResult.error);
            continue;
          }

          const sourcePath = fromResult.resolvedPath;
          const targetPath = toResult.resolvedPath;

          if (!(await fs.exists(sourcePath))) {
            errors.push(`Source file not found: ${operation.from}`);
            continue;
          }

          if (await fs.exists(targetPath)) {
            errors.push(`Destination file already exists: ${operation.to}`);
            continue;
          }

          const parentDir = path.dirname(targetPath);
          await fs.createDirectory(parentDir);
          await fs.copyFile(sourcePath, targetPath);
          break;
        }

        case 'append_file': {
          const result = validateWorkspacePath(operation.path, workspaceFolders);
          if (!result.valid) {
            errors.push(result.error);
            continue;
          }

          const filePath = result.resolvedPath;

          let existingContent = '';
          if (!(await fs.exists(filePath))) {
            errors.push(`File not found: ${operation.path}`);
            continue;
          }
          existingContent = await fs.readFile(filePath);

          const updatedContent = operation.position === 'end'
            ? existingContent + operation.content
            : operation.content + existingContent;

          await fs.writeFile(filePath, updatedContent);
          break;
        }

        case 'create_directory': {
          const result = validateWorkspacePath(operation.directoryPath, workspaceFolders);
          if (!result.valid) {
            errors.push(result.error);
            continue;
          }

          const directoryPath = result.resolvedPath;
          await fs.createDirectory(directoryPath);

          for (const file of operation.files) {
            const fileResult = validateWorkspacePath(path.join(operation.directoryPath, file), workspaceFolders);
            if (!fileResult.valid) {
              errors.push(fileResult.error);
              continue;
            }
            const filePath = fileResult.resolvedPath;
            const parentDir = path.dirname(filePath);
            await fs.createDirectory(parentDir);
            await fs.writeFile(filePath, '');
          }
          break;
        }

        case 'delete_directory': {
          const result = validateWorkspacePath(operation.directoryPath, workspaceFolders);
          if (!result.valid) {
            errors.push(result.error);
            continue;
          }

          const directoryPath = result.resolvedPath;

          if (!(await fs.exists(directoryPath))) {
            break;
          }

          await fs.deleteDirectoryRecursive(directoryPath);

          if (await fs.exists(directoryPath)) {
            errors.push(`Failed to delete directory: ${operation.directoryPath}`);
          }
          break;
        }

        case 'move_directory': {
          const fromResult = validateWorkspacePath(operation.from, workspaceFolders);
          if (!fromResult.valid) {
            errors.push(fromResult.error);
            continue;
          }

          const toResult = validateWorkspacePath(operation.to, workspaceFolders);
          if (!toResult.valid) {
            errors.push(toResult.error);
            continue;
          }

          const sourcePath = fromResult.resolvedPath;
          const targetPath = toResult.resolvedPath;

          if (!(await fs.exists(sourcePath))) {
            errors.push(`Source directory not found: ${operation.from}`);
            continue;
          }

          if (await fs.exists(targetPath)) {
            errors.push(`Destination directory already exists: ${operation.to}`);
            continue;
          }

          await fs.moveDirectory(sourcePath, targetPath);
          break;
        }

        case 'extract_structure': {
          console.error('DEBUG extract_structure: directoryPath=' + operation.directoryPath + ', depth=' + operation.depth);
          console.error('DEBUG extract_structure: workspaceFolders=' + JSON.stringify(workspaceFolders));
          const result = validateWorkspacePath(operation.directoryPath, workspaceFolders);
          console.error('DEBUG extract_structure: validateWorkspacePath result=' + JSON.stringify(result));
          if (!result.valid) {
            errors.push(result.error);
            continue;
          }

          const directoryPath = result.resolvedPath;
          const exists = await fs.exists(directoryPath);
          console.error('DEBUG extract_structure: fs.exists result=' + exists);
          if (!exists) {
            errors.push(`Directory not found: ${operation.directoryPath}`);
            continue;
          }

          const json = await extractDirectoryStructure(fs, directoryPath, operation.depth);
          let parsed: Record<string, any> = {};
          try {
            parsed = JSON.parse(json);
          } catch {
            // ignore parse errors for counting
          }
          let fileCount = 0;
          let directoryCount = 0;
          for (const value of Object.values(parsed)) {
            if (Array.isArray(value)) {
              for (const item of value) {
                if (typeof item === 'string') {
                  fileCount++;
                } else if (typeof item === 'object' && item !== null) {
                  directoryCount++;
                }
              }
            }
          }
          extractionResults.push({
            directoryPath: operation.directoryPath,
            depth: operation.depth,
            json,
            fileCount,
            directoryCount,
          });
          break;
        }

        case 'codebase_metadata': {
          if (workspaceFolders.length === 0) {
            errors.push('No workspace root available for codebase metadata.');
            continue;
          }

          const workspaceRoot = workspaceFolders[0];
          const metadata = await extractCodebaseMetadata(fs, workspaceRoot);
          const message = JSON.stringify(metadata, null, 2);
          return { success: true, message, errors };
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error && err.stack ? `\nStack: ${err.stack}` : '';
      errors.push(`Unexpected error during ${operation.kind}: ${message}${operation.kind === 'extract_structure' ? stack : ''}`);
    }
  }

  let result: { success: boolean; message: string; errors: string[] };

  if (extractionResults.length > 0) {
    const allSucceeded = extractionResults.length === operations.filter(o => o.kind === 'extract_structure').length;
    const message = JSON.stringify(extractionResults.map(r => ({
      directoryPath: r.directoryPath,
      depth: r.depth,
      fileCount: r.fileCount,
      directoryCount: r.directoryCount,
      json: r.json,
    })));
    result = { success: allSucceeded, message, errors };
  } else {
    const total = operations.length;
    const errorCount = errors.length;
    const successCount = total - errorCount;

    if (errorCount === 0) {
      result = { success: true, message: `Successfully executed ${total} file operations.`, errors: [] };
    } else if (successCount > 0) {
      result = {
        success: true,
        message: `Executed ${successCount} of ${total} operations with ${errorCount} errors.`,
        errors,
      };
    } else {
      result = { success: false, message: `All ${total} operations failed.`, errors };
    }
  }

  if (historyStore && sessionId && preSnapshot) {
    const postSnapshot = await createSnapshot(sessionId, 'post', fs, filesAffected, preSnapshot);
    await recordAndSaveSession(
      operations,
      result,
      filesAffected,
      originalPrompt || '',
      preSnapshot,
      postSnapshot,
      historyStore,
      sessionId,
    );
  }

  return result;
}