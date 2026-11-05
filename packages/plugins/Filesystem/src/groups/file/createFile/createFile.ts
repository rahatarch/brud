import type { OperationResult } from '@brud/kernel';
import { executeMutation } from '../../../coordinator/index.js';
import { checkBytes } from '../../../governor/index.js';
import { readRequiredString, readString } from '../../../input.js';
import type { FilesystemRuntime } from '../../../runtime.js';
import { governorFailure } from '../../../toolSupport.js';

export const CREATE_FILE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    path: {
      type: 'string',
      description: 'File path',
    },
    content: {
      type: 'string',
      description: 'File contents',
    },
  },
  required: ['path', 'content'],
  additionalProperties: false,
};

export async function createFile(
  input: Record<string, unknown>,
  runtime: FilesystemRuntime,
): Promise<OperationResult> {
  const path = readRequiredString(input, 'path');
  const content = readString(input, 'content');
  const bytes = checkBytes(Buffer.byteLength(content, 'utf8'));

  if (!bytes.ok) {
    return governorFailure('create_file', bytes);
  }

  return executeMutation(runtime, {
    kind: 'create_file',
    targets: [path],
    apply: async () => {
      await runtime.getFileSystem().createFile(path, content, { overwrite: false });

      return {
        files: [{ path, status: 'created' }],
        message: `Created ${path}.`,
      };
    },
  });
}