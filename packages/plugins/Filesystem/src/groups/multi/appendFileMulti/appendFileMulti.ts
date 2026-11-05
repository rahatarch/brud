import type { OperationResult } from '@brud/kernel';
import {
  buildFailureResult,
  executeMutation,
} from '../../../coordinator/index.js';
import { buildSkipEntry } from '../../../envelope/index.js';
import type {
  MutationFileEntry,
  MutationSkipEntry,
} from '../../../envelope/index.js';
import { toFilesystemError } from '../../../errors/index.js';
import {
  MAX_CONCURRENCY,
  checkBatch,
  checkBytes,
  runWithConcurrency,
} from '../../../governor/index.js';
import {
  readOptionalString,
  readPosition,
  readRequiredString,
  readString,
} from '../../../input.js';
import { resolveSearchFiles } from '../../../search/index.js';
import type { FilesystemRuntime } from '../../../runtime.js';
import { governorFailure, validateScope } from '../../../toolSupport.js';

export const APPEND_FILE_MULTI_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    pattern: {
      type: 'string',
      description: 'Glob pattern to match files',
    },
    scope: {
      type: 'string',
      description: 'Directory to search',
    },
    position: {
      type: 'string',
      enum: ['start', 'end'],
      default: 'end',
      description: 'Start or end',
    },
    content: {
      type: 'string',
      description: 'Content to append',
    },
  },
  required: ['pattern', 'content'],
  additionalProperties: false,
};

export async function appendFileMulti(
  input: Record<string, unknown>,
  runtime: FilesystemRuntime,
): Promise<OperationResult> {
  const pattern = readRequiredString(input, 'pattern');
  const scope = readOptionalString(input, 'scope');
  const position = readPosition(input);
  const content = readString(input, 'content');

  let candidates: string[];

  try {
    await validateScope(runtime, scope);
    candidates = await resolveSearchFiles(runtime.executeTool, {
      pattern,
      ...(scope === undefined ? {} : { scope }),
    });
  } catch (error: unknown) {
    return buildFailureResult('append_file_multi', error);
  }

  const batch = checkBatch(candidates);

  if (!batch.ok) {
    return governorFailure('append_file_multi', batch);
  }

  const byteBudget = checkBytes(
    Buffer.byteLength(content, 'utf8') * candidates.length,
  );

  if (!byteBudget.ok) {
    return governorFailure('append_file_multi', byteBudget);
  }

  return executeMutation(runtime, {
    kind: 'append_file_multi',
    targets: candidates,
    apply: async () => {
      const fs = runtime.getFileSystem();
      const outcomes = await runWithConcurrency(
        candidates,
        MAX_CONCURRENCY,
        async (path): Promise<{
          file?: MutationFileEntry;
          skip?: MutationSkipEntry;
        }> => {
          try {
            if (!(await fs.exists(path))) {
              return {
                skip: buildSkipEntry(
                  path,
                  `File not found: ${path}`,
                  'FILE_NOT_FOUND',
                ),
              };
            }

            const existing = await fs.readText(path);
            const updated = position === 'end'
              ? existing + '\n\n' + content
              : content + '\n\n' + existing;

            await fs.writeAtomic(path, updated);

            return { file: { path, status: 'appended' } };
          } catch (error: unknown) {
            const filesystemError = toFilesystemError(error, path);

            return {
              skip: buildSkipEntry(
                path,
                filesystemError.message,
                filesystemError.code,
              ),
            };
          }
        },
      );

      const files = outcomes.flatMap((outcome) =>
        outcome.file === undefined ? [] : [outcome.file],
      );
      const skipped = outcomes.flatMap((outcome) =>
        outcome.skip === undefined ? [] : [outcome.skip],
      );

      return {
        files,
        skipped,
        message: `Appended content to ${files.length} files.`,
      };
    },
  });
}