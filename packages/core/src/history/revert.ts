import { applyPatch, parsePatch } from 'diff';
import type { HistoryEntry } from './types.js';
import type { FileSystem } from '../types/filesystem.js';

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

export async function revertSession(
  entry: HistoryEntry,
  targetState: 'pre' | 'post',
  fs: FileSystem,
): Promise<RevertResult> {
  const errors: string[] = [];
  const { preSnapshot, postSnapshot } = entry;

  if (targetState === 'pre') {
    const preFiles = preSnapshot.files;
    const postFiles = postSnapshot.files;

    const writePromises: Promise<void>[] = [];
    const deletePromises: Promise<void>[] = [];

    for (const [filePath, content] of preFiles) {
      writePromises.push(
        fs.writeFile(filePath, content).catch((err: Error) => {
          errors.push(`Failed to write ${filePath}: ${err.message}`);
        }),
      );
    }

    const createdInPost = new Set(postFiles.keys());
    for (const filePath of preFiles.keys()) {
      createdInPost.delete(filePath);
    }
    for (const filePath of createdInPost) {
      deletePromises.push(
        fs.deleteFile(filePath).catch((err: Error) => {
          errors.push(`Failed to delete ${filePath}: ${err.message}`);
        }),
      );
    }

    await Promise.all([...writePromises, ...deletePromises]);

    if (errors.length > 0) {
      return {
        success: false,
        message: `Revert to pre-patch state completed with ${errors.length} error(s)`,
        errors,
      };
    }

    return {
      success: true,
      message: `Successfully reverted to pre-patch state (${preFiles.size} files restored${createdInPost.size > 0 ? `, ${createdInPost.size} files deleted` : ''})`,
      errors: [],
    };
  }

  // targetState === 'post'
  const preFiles = preSnapshot.files;
  const postFiles = postSnapshot.files;

  const writePromises: Promise<void>[] = [];

  for (const [filePath, postDiff] of postFiles) {
    const preContent = preFiles.get(filePath);

    if (preContent !== undefined) {
      const reconstructed = applyDiff(preContent, postDiff);
      if (reconstructed === false) {
        errors.push(`Failed to apply diff for ${filePath}`);
        continue;
      }
      writePromises.push(
        fs.writeFile(filePath, reconstructed).catch((err: Error) => {
          errors.push(`Failed to write ${filePath}: ${err.message}`);
        }),
      );
    } else {
      writePromises.push(
        fs.writeFile(filePath, postDiff).catch((err: Error) => {
          errors.push(`Failed to write ${filePath}: ${err.message}`);
        }),
      );
    }
  }

  await Promise.all(writePromises);

  if (errors.length > 0) {
    return {
      success: false,
      message: `Revert to post-patch state completed with ${errors.length} error(s)`,
      errors,
    };
  }

  return {
    success: true,
    message: `Successfully reverted to post-patch state (${postFiles.size} files restored)`,
    errors: [],
  };
}