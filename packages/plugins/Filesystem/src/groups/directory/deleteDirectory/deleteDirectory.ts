import type { OperationResult } from '@brud/kernel';
import {
  buildFailureResult,
  executeMutation,
} from '../../../coordinator/index.js';
import { buildSkipEntry } from '../../../envelope/index.js';
import { FilesystemError } from '../../../errors/index.js';
import { readRequiredString } from '../../../input.js';
import { assertSafeTarget } from '../../../paths.js';
import type { FilesystemRuntime } from '../../../runtime.js';
import { collectFiles } from '../../../toolSupport.js';

export const DELETE_DIRECTORY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    directoryPath: {
      type: 'string',
      description: 'Directory path to delete',
    },
  },
  required: ['directoryPath'],
  additionalProperties: false,
};

export async function deleteDirectory(
  input: Record<string, unknown>,
  runtime: FilesystemRuntime,
): Promise<OperationResult> {
  const directoryPath = readRequiredString(input, 'directoryPath');
  const fs = runtime.getFileSystem();

  let exists = false;
  let files: string[] = [];

  try {
    assertSafeTarget(directoryPath);

    const stats = await fs.stat(directoryPath);

    if (stats !== null && !stats.isDirectory) {
      throw new FilesystemError(
        'CANNOT_DELETE_FILE_AS_DIRECTORY',
        directoryPath,
        `Cannot delete a file as a directory: "${directoryPath}"`,
      );
    }

    if (stats !== null) {
      exists = true;
      files = await collectFiles(fs, directoryPath);
    }
  } catch (error: unknown) {
    return buildFailureResult('delete_directory', error, directoryPath);
  }

  return executeMutation(runtime, {
    kind: 'delete_directory',
    targets: [directoryPath, ...files],
    sessionTargets: files,
    apply: async () => {
      if (!exists) {
        const message = `${directoryPath} does not exist. Nothing to delete.`;

        return {
          skipped: [buildSkipEntry(directoryPath, message, 'DIRECTORY_NOT_FOUND')],
          message,
        };
      }

      await fs.deleteDirectory(directoryPath);

      return {
        files: files.map((path) => ({ path, status: 'deleted' as const })),
        message: `Deleted directory ${directoryPath} and all its contents.`,
      };
    },
  });
}