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
  readRequiredString,
  readString,
} from '../../../input.js';
import {
  applySingleMatch,
  stripNumericLinePrefixes,
} from '../../../match/index.js';
import { resolveSearchFiles } from '../../../search/index.js';
import type { FilesystemRuntime } from '../../../runtime.js';
import { governorFailure, validateScope } from '../../../toolSupport.js';

export const SEARCH_REPLACE_MULTI_SCHEMA: Record<string, unknown> = {
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
    search: {
      type: 'string',
      description: 'Text to find',
    },
    replace: {
      type: 'string',
      description: 'Replacement text',
    },
  },
  required: ['pattern', 'search', 'replace'],
  additionalProperties: false,
};

export async function searchReplaceMulti(
  input: Record<string, unknown>,
  runtime: FilesystemRuntime,
): Promise<OperationResult> {
  const pattern = readRequiredString(input, 'pattern');
  const scope = readOptionalString(input, 'scope');
  const search = readString(input, 'search');
  const replace = readString(input, 'replace');

  let candidates: string[];

  try {
    await validateScope(runtime, scope);
    candidates = await resolveSearchFiles(runtime.executeTool, {
      pattern,
      ...(scope === undefined ? {} : { scope }),
    });
  } catch (error: unknown) {
    return buildFailureResult('search_replace_multi', error);
  }

  const batch = checkBatch(candidates);

  if (!batch.ok) {
    return governorFailure('search_replace_multi', batch);
  }

  const byteBudget = checkBytes(
    (Buffer.byteLength(search, 'utf8') + Buffer.byteLength(replace, 'utf8'))
    * candidates.length,
  );

  if (!byteBudget.ok) {
    return governorFailure('search_replace_multi', byteBudget);
  }

  return executeMutation(runtime, {
    kind: 'search_replace_multi',
    targets: candidates,
    apply: async () => {
      const fs = runtime.getFileSystem();
      const cleanSearch = stripNumericLinePrefixes(search);

      const outcomes = await runWithConcurrency(
        candidates,
        MAX_CONCURRENCY,
        async (path): Promise<{
          file?: MutationFileEntry;
          skip?: MutationSkipEntry;
        }> => {
          try {
            const content = await fs.readText(path);
            const applied = applySingleMatch(content, cleanSearch, replace);

            if (!applied.ok) {
              return {
                skip: buildSkipEntry(path, applied.message, applied.code),
              };
            }

            await fs.writeAtomic(path, applied.value.content);

            return { file: { path, status: 'replaced' } };
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
      const skipSuffix = skipped.length > 0
        ? ` Skipped ${skipped.length} files.`
        : '';

      return {
        files,
        skipped,
        message: `Patched ${files.length} files.${skipSuffix}`,
      };
    },
  });
}