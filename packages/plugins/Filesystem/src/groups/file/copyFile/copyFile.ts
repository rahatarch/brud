import type { OperationResult } from '@brud/kernel';
import { executeMutation } from '../../../coordinator/index.js';
import { readRequiredString } from '../../../input.js';
import { dirnamePath } from '../../../paths.js';
import type { FilesystemRuntime } from '../../../runtime.js';

export const COPY_FILE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    from: {
      type: 'string',
      description: 'Source file path',
    },
    to: {
      type: 'string',
      description: 'Destination file path',
    },
  },
  required: ['from', 'to'],
  additionalProperties: false,
};

export async function copyFile(
  input: Record<string, unknown>,
  runtime: FilesystemRuntime,
): Promise<OperationResult> {
  const from = readRequiredString(input, 'from');
  const to = readRequiredString(input, 'to');

  return executeMutation(runtime, {
    kind: 'copy_file',
    targets: [from, to],
    apply: async () => {
      const fs = runtime.getFileSystem();
      const parent = dirnamePath(to);

      if (parent.length > 0) {
        await fs.createDirectory(parent);
      }

      await fs.copy(from, to);

      return {
        files: [{ path: from, status: 'copied', from, to }],
        message: `Copied ${from} to ${to}.`,
      };
    },
  });
}