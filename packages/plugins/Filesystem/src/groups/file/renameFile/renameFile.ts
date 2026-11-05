import type { OperationResult } from '@brud/kernel';
import { executeMutation } from '../../../coordinator/index.js';
import { readRequiredString } from '../../../input.js';
import type { FilesystemRuntime } from '../../../runtime.js';

export const RENAME_FILE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    from: {
      type: 'string',
      description: 'Current file path',
    },
    to: {
      type: 'string',
      description: 'New file path',
    },
  },
  required: ['from', 'to'],
  additionalProperties: false,
};

export async function renameFile(
  input: Record<string, unknown>,
  runtime: FilesystemRuntime,
): Promise<OperationResult> {
  const from = readRequiredString(input, 'from');
  const to = readRequiredString(input, 'to');

  return executeMutation(runtime, {
    kind: 'rename_file',
    targets: [from, to],
    apply: async () => {
      await runtime.getFileSystem().rename(from, to);

      return {
        files: [{ path: from, status: 'renamed', from, to }],
        message: `Renamed ${from} to ${to}.`,
      };
    },
  });
}