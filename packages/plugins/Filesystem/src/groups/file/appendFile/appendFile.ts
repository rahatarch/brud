import type { OperationResult } from '@brud/kernel';
import { executeMutation } from '../../../coordinator/index.js';
import { FilesystemError } from '../../../errors/index.js';
import { checkBytes } from '../../../governor/index.js';
import {
  readPosition,
  readRequiredString,
  readString,
} from '../../../input.js';
import type { FilesystemRuntime } from '../../../runtime.js';
import { governorFailure } from '../../../toolSupport.js';

export const APPEND_FILE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    path: {
      type: 'string',
      description: 'File path',
    },
    position: {
      type: 'string',
      enum: ['start', 'end'],
      default: 'end',
      description: 'Where to append: start or end',
    },
    content: {
      type: 'string',
      description: 'Content to append',
    },
  },
  required: ['path', 'content'],
  additionalProperties: false,
};

export async function appendFile(
  input: Record<string, unknown>,
  runtime: FilesystemRuntime,
): Promise<OperationResult> {
  const path = readRequiredString(input, 'path');
  const position = readPosition(input);
  const content = readString(input, 'content');
  const bytes = checkBytes(Buffer.byteLength(content, 'utf8'));

  if (!bytes.ok) {
    return governorFailure('append_file', bytes);
  }

  return executeMutation(runtime, {
    kind: 'append_file',
    targets: [path],
    apply: async () => {
      const fs = runtime.getFileSystem();

      if (!(await fs.exists(path))) {
        throw new FilesystemError('FILE_NOT_FOUND', path, `File not found: ${path}`);
      }

      const existing = await fs.readText(path);
      const updated = position === 'end'
        ? existing + '\n\n' + content
        : content + '\n\n' + existing;

      await fs.writeAtomic(path, updated);

      return {
        files: [{ path, status: 'appended' }],
        message: `Appended content to ${path}.`,
      };
    },
  });
}