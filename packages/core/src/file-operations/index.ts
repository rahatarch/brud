import path from 'path';
import { FileOperation } from '../types/patch';
import { FileSystem } from '../types/filesystem';
import { validateWorkspacePath } from '../utils/workspacePath';

export async function executeFileOperations(
  operations: FileOperation[],
  fs: FileSystem,
  workspaceFolders: string[],
): Promise<{ success: boolean; message: string; errors: string[] }> {
  if (operations.length === 0) {
    return { success: false, message: 'No operations to execute.', errors: ['No operations to execute.'] };
  }

  const errors: string[] = [];

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