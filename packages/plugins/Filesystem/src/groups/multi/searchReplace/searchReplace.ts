import type { OperationResult } from '@brud/kernel';
import { executeMutation } from '../../../coordinator/index.js';
import { FilesystemError } from '../../../errors/index.js';
import { checkBytes } from '../../../governor/index.js';
import {
  readRequiredString,
  readString,
} from '../../../input.js';
import {
  applySingleMatch,
  stripNumericLinePrefixes,
} from '../../../match/index.js';
import type { FilesystemRuntime } from '../../../runtime.js';
import { governorFailure } from '../../../toolSupport.js';

export const SEARCH_REPLACE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    path: {
      type: 'string',
      description: 'File path',
    },
    search: {
      type: 'string',
      description: 'Exact text to find',
    },
    replace: {
      type: 'string',
      description: 'New text to insert',
    },
  },
  required: ['path', 'search', 'replace'],
  additionalProperties: false,
};

export async function searchReplace(
  input: Record<string, unknown>,
  runtime: FilesystemRuntime,
): Promise<OperationResult> {
  const path = readRequiredString(input, 'path');
  const search = readString(input, 'search');
  const replace = readString(input, 'replace');
  const bytes = checkBytes(
    Buffer.byteLength(search, 'utf8') + Buffer.byteLength(replace, 'utf8'),
  );

  if (!bytes.ok) {
    return governorFailure('search_replace', bytes);
  }

  return executeMutation(runtime, {
    kind: 'search_replace',
    targets: [path],
    apply: async () => {
      const fs = runtime.getFileSystem();

      if (!(await fs.exists(path))) {
        throw new FilesystemError('FILE_NOT_FOUND', path, `File not found: ${path}`);
      }

      const content = await fs.readText(path);
      const cleanSearch = stripNumericLinePrefixes(search);
      const applied = applySingleMatch(content, cleanSearch, replace);

      if (!applied.ok) {
        throw new FilesystemError(applied.code, path, applied.message);
      }

      await fs.writeAtomic(path, applied.value.content);

      return {
        files: [{ path, status: 'replaced' }],
        message: `Patched ${path}.`,
      };
    },
  });
}