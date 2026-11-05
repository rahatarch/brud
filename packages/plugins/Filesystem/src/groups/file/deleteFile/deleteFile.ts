import type { OperationResult } from '@brud/kernel';
import { executeMutation } from '../../../coordinator/index.js';
import { buildSkipEntry } from '../../../envelope/index.js';
import { readRequiredString } from '../../../input.js';
import type { FilesystemRuntime } from '../../../runtime.js';

export const DELETE_FILE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    path: {
      type: 'string',
      description: 'File path to delete',
    },
  },
  required: ['path'],
  additionalProperties: false,
};

export async function deleteFile(
  input: Record<string, unknown>,
  runtime: FilesystemRuntime,
): Promise<OperationResult> {
  const path = readRequiredString(input, 'path');

  return executeMutation(runtime, {
    kind: 'delete_file',
    targets: [path],
    apply: async () => {
      const fs = runtime.getFileSystem();

      if (!(await fs.exists(path))) {
        const message = `${path} does not exist. Nothing to delete.`;

        return {
          skipped: [buildSkipEntry(path, message, 'FILE_NOT_FOUND')],
          message,
        };
      }

      await fs.deleteFile(path);

      return {
        files: [{ path, status: 'deleted' }],
        message: `Deleted ${path}.`,
      };
    },
  });
}