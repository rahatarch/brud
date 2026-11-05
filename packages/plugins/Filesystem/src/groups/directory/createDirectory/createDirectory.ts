import type { OperationResult } from '@brud/kernel';
import {
  buildFailureResult,
  executeMutation,
} from '../../../coordinator/index.js';
import {
  readOptionalStringArray,
  readRequiredString,
} from '../../../input.js';
import { assertSafeTarget, joinPath } from '../../../paths.js';
import type { FilesystemRuntime } from '../../../runtime.js';
import { collectIntermediateDirectories } from '../../../toolSupport.js';

export const CREATE_DIRECTORY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    directoryPath: {
      type: 'string',
      description: 'Directory path to create',
    },
    files: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional empty files to create inside',
    },
  },
  required: ['directoryPath'],
  additionalProperties: false,
};

export async function createDirectory(
  input: Record<string, unknown>,
  runtime: FilesystemRuntime,
): Promise<OperationResult> {
  const directoryPath = readRequiredString(input, 'directoryPath');
  const files = readOptionalStringArray(input, 'files') ?? [];
  let filePaths: string[] = [];
  let directoryTargets: string[] = [];

  try {
    for (const file of files) {
      assertSafeTarget(file);
    }

    filePaths = files.map((file) => joinPath(directoryPath, file));
    directoryTargets = collectIntermediateDirectories(directoryPath, filePaths);
  } catch (error: unknown) {
    return buildFailureResult('create_directory', error, directoryPath);
  }

  return executeMutation(runtime, {
    kind: 'create_directory',
    targets: [directoryPath, ...filePaths],
    sessionTargets: [...directoryTargets, ...filePaths],
    apply: async () => {
      const fs = runtime.getFileSystem();

      await fs.createDirectory(directoryPath);

      for (const filePath of filePaths) {
        await fs.writeAtomic(filePath, '');
      }

      return {
        files: filePaths.map((path) => ({ path, status: 'created' as const })),
        message: `Created directory ${directoryPath} with ${files.length} files.`,
      };
    },
  });
}