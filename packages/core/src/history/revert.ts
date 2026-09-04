import { applyPatch, parsePatch } from 'diff';
import * as path from 'path';
import type { HistoryEntry, OperationResult } from './types.js';
import type { FileSystem } from '../types/filesystem.js';
import { validateWorkspacePath } from '../utils/workspacePath.js';

export interface RevertResult {
  success: boolean;
  message: string;
  errors: string[];
}

function applyDiff(content: string, diff: string): string | false {
  try {
    const parsed = parsePatch(diff);
    if (parsed.length === 0) return false;
    const result = applyPatch(content, parsed[0]);
    return result;
  } catch {
    return false;
  }
}

async function revertFileContent(
  filePath: string,
  targetState: 'pre' | 'post',
  preFiles: Map<string, string>,
  postFiles: Map<string, string>,
  fs: FileSystem,
  errors: string[],
): Promise<void> {
  if (targetState === 'pre') {
    const preContent = preFiles.get(filePath);
    if (preContent !== undefined) {
      await fs.writeFile(filePath, preContent);
    }
  } else {
    const postDiff = postFiles.get(filePath);
    if (postDiff !== undefined) {
      const preContent = preFiles.get(filePath);
      if (preContent !== undefined) {
        const reconstructed = applyDiff(preContent, postDiff);
        if (reconstructed === false) {
          errors.push(`Failed to apply diff for ${filePath}`);
          return;
        }
        await fs.writeFile(filePath, reconstructed);
      } else {
        const reconstructed = applyDiff('', postDiff);
        if (reconstructed === false) {
          errors.push(`Failed to apply diff for ${filePath}`);
          return;
        }
        await fs.writeFile(filePath, reconstructed);
      }
    }
  }
}

export async function revertSession(
  entry: HistoryEntry,
  targetState: 'pre' | 'post',
  fs: FileSystem,
  workspaceFolders: string[],
): Promise<RevertResult> {
  const errors: string[] = [];
  const { session, preSnapshot, postSnapshot } = entry;
  const preFiles = preSnapshot.files;
  const postFiles = postSnapshot.files;

  for (const op of session.operations) {
    if (op.status !== 'success') continue;

    try {
      switch (op.kind) {
        case 'search_replace':
        case 'append_file': {
          const result = validateWorkspacePath(op.path, workspaceFolders);
          if (!result.valid) {
            errors.push(result.error);
            break;
          }
          await revertFileContent(result.resolvedPath, targetState, preFiles, postFiles, fs, errors);
          break;
        }

        case 'create_file': {
          const result = validateWorkspacePath(op.path, workspaceFolders);
          if (!result.valid) {
            errors.push(result.error);
            break;
          }
          const resolvedPath = result.resolvedPath;
          if (targetState === 'pre') {
            if (await fs.exists(resolvedPath)) {
              await fs.deleteFile(resolvedPath);
            }
          } else {
            const postDiff = postFiles.get(resolvedPath);
            if (postDiff !== undefined) {
              const preContent = preFiles.get(resolvedPath) ?? '';
              const reconstructed = applyDiff(preContent, postDiff);
              if (reconstructed === false) {
                errors.push(`Failed to apply diff for ${resolvedPath}`);
                break;
              }
              const parentDir = path.dirname(resolvedPath);
              if (parentDir) {
                await fs.createDirectory(parentDir);
              }
              await fs.writeFile(resolvedPath, reconstructed);
            }
          }
          break;
        }

        case 'delete_file': {
          const result = validateWorkspacePath(op.path, workspaceFolders);
          if (!result.valid) {
            errors.push(result.error);
            break;
          }
          const resolvedPath = result.resolvedPath;
          if (targetState === 'pre') {
            const preContent = preFiles.get(resolvedPath);
            if (preContent !== undefined) {
              const parentDir = path.dirname(resolvedPath);
              if (parentDir) {
                await fs.createDirectory(parentDir);
              }
              await fs.writeFile(resolvedPath, preContent);
            }
          } else {
            if (await fs.exists(resolvedPath)) {
              await fs.deleteFile(resolvedPath);
            }
          }
          break;
        }

        case 'rename_file': {
          const from = op.from;
          const to = op.to;
          if (from && to) {
            const fromResult = validateWorkspacePath(from, workspaceFolders);
            const toResult = validateWorkspacePath(to, workspaceFolders);
            if (!fromResult.valid) { errors.push(fromResult.error); break; }
            if (!toResult.valid) { errors.push(toResult.error); break; }
            if (targetState === 'pre') {
              if (await fs.exists(toResult.resolvedPath)) {
                await fs.renameFile(toResult.resolvedPath, fromResult.resolvedPath);
              }
            } else {
              if (await fs.exists(fromResult.resolvedPath)) {
                await fs.renameFile(fromResult.resolvedPath, toResult.resolvedPath);
              }
            }
          }
          break;
        }

        case 'move_file': {
          const from = op.from;
          const to = op.to;
          if (from && to) {
            const fromResult = validateWorkspacePath(from, workspaceFolders);
            const toResult = validateWorkspacePath(to, workspaceFolders);
            if (!fromResult.valid) { errors.push(fromResult.error); break; }
            if (!toResult.valid) { errors.push(toResult.error); break; }
            if (targetState === 'pre') {
              if (await fs.exists(toResult.resolvedPath)) {
                const parentDir = path.dirname(fromResult.resolvedPath);
                if (parentDir) {
                  await fs.createDirectory(parentDir);
                }
                await fs.renameFile(toResult.resolvedPath, fromResult.resolvedPath);
              }
            } else {
              if (await fs.exists(fromResult.resolvedPath)) {
                const parentDir = path.dirname(toResult.resolvedPath);
                if (parentDir) {
                  await fs.createDirectory(parentDir);
                }
                await fs.renameFile(fromResult.resolvedPath, toResult.resolvedPath);
              }
            }
          }
          break;
        }

        case 'copy_file': {
          const from = op.from;
          const to = op.to;
          if (from && to) {
            const fromResult = validateWorkspacePath(from, workspaceFolders);
            const toResult = validateWorkspacePath(to, workspaceFolders);
            if (!fromResult.valid) { errors.push(fromResult.error); break; }
            if (!toResult.valid) { errors.push(toResult.error); break; }
            if (targetState === 'pre') {
              if (await fs.exists(toResult.resolvedPath)) {
                await fs.deleteFile(toResult.resolvedPath);
              }
            } else {
              if (await fs.exists(fromResult.resolvedPath)) {
                const parentDir = path.dirname(toResult.resolvedPath);
                if (parentDir) {
                  await fs.createDirectory(parentDir);
                }
                const content = await fs.readFile(fromResult.resolvedPath);
                await fs.writeFile(toResult.resolvedPath, content);
              }
            }
          }
          break;
        }

        case 'create_directory': {
          const dirPath = op.directoryPath;
          if (!dirPath) break;

          const result = validateWorkspacePath(dirPath, workspaceFolders);
          if (!result.valid) {
            errors.push(result.error);
            break;
          }
          const resolvedDirPath = result.resolvedPath;

          if (targetState === 'pre') {
            if (await fs.exists(resolvedDirPath)) {
              await fs.deleteDirectoryRecursive(resolvedDirPath);
            }
          } else {
            await fs.createDirectory(resolvedDirPath);
            const files = op.files || [];
            for (const file of files) {
              const filePath = path.join(resolvedDirPath, file);
              const parentDir = path.dirname(filePath);
              await fs.createDirectory(parentDir);
              await fs.writeFile(filePath, '');
            }
          }
          break;
        }

        case 'delete_directory': {
          const dirPath = op.directoryPath;
          if (!dirPath) break;

          const result = validateWorkspacePath(dirPath, workspaceFolders);
          if (!result.valid) {
            errors.push(result.error);
            break;
          }
          const resolvedDirPath = result.resolvedPath;

          if (targetState === 'pre') {
            await fs.createDirectory(resolvedDirPath);
            for (const [filePath, content] of preFiles) {
              const relative = path.relative(resolvedDirPath, filePath);
              if (relative === '' || !relative.startsWith('..')) {
                const parentDir = path.dirname(filePath);
                await fs.createDirectory(parentDir);
                if (content) {
                  await fs.writeFile(filePath, content);
                }
              }
            }
          } else {
            if (await fs.exists(resolvedDirPath)) {
              await fs.deleteDirectoryRecursive(resolvedDirPath);
            }
          }
          break;
        }

        case 'move_directory': {
          const from = op.from;
          const to = op.to;
          if (from && to) {
            const fromResult = validateWorkspacePath(from, workspaceFolders);
            const toResult = validateWorkspacePath(to, workspaceFolders);
            if (!fromResult.valid) { errors.push(fromResult.error); break; }
            if (!toResult.valid) { errors.push(toResult.error); break; }
            if (targetState === 'pre') {
              if (await fs.exists(toResult.resolvedPath)) {
                const parentDir = path.dirname(fromResult.resolvedPath);
                if (parentDir) {
                  await fs.createDirectory(parentDir);
                }
                await fs.moveDirectory(toResult.resolvedPath, fromResult.resolvedPath);
              }
            } else {
              if (await fs.exists(fromResult.resolvedPath)) {
                const parentDir = path.dirname(toResult.resolvedPath);
                if (parentDir) {
                  await fs.createDirectory(parentDir);
                }
                await fs.moveDirectory(fromResult.resolvedPath, toResult.resolvedPath);
              }
            }
          }
          break;
        }

        case 'extract_structure':
        case 'codebase_metadata':
          break;

        default:
          errors.push(`Unknown operation kind: ${op.kind}`);
          break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to revert ${op.kind} (${op.path}): ${message}`);
    }
  }

  if (errors.length > 0) {
    return {
      success: false,
      message: `Revert to ${targetState}-patch state completed with ${errors.length} error(s)`,
      errors,
    };
  }

  return {
    success: true,
    message: `Successfully reverted to ${targetState}-patch state (${session.operations.length} operations reversed)`,
    errors: [],
  };
}