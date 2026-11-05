import type { OperationResult } from '@brud/kernel';
import {
  buildFailureResult,
  executeMutation,
} from '../../../coordinator/index.js';
import { FilesystemError } from '../../../errors/index.js';
import { readRequiredString } from '../../../input.js';
import { assertSafeTarget } from '../../../paths.js';
import type { FilesystemRuntime } from '../../../runtime.js';
import {
  collectDirectories,
  collectFiles,
  rebasePath,
} from '../../../toolSupport.js';

export const MOVE_DIRECTORY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    from: {
      type: 'string',
      description: 'Source directory path',
    },
    to: {
      type: 'string',
      description: 'Destination directory path',
    },
  },
  required: ['from', 'to'],
  additionalProperties: false,
};

export async function moveDirectory(
  input: Record<string, unknown>,
  runtime: FilesystemRuntime,
): Promise<OperationResult> {
  const from = readRequiredString(input, 'from');
  const to = readRequiredString(input, 'to');
  const fs = runtime.getFileSystem();

  let files: string[] = [];
  let directories: string[] = [];

  try {
    assertSafeTarget(from);
    assertSafeTarget(to);

    const source = await fs.stat(from);

    if (source === null || !source.isDirectory) {
      throw new FilesystemError(
        'DIRECTORY_NOT_FOUND',
        from,
        `Directory not found: "${from}"`,
      );
    }

    const destination = await fs.stat(to);

    if (destination !== null) {
      throw new FilesystemError(
        'CONFLICT',
        to,
        `Destination already exists: "${to}"`,
      );
    }

    files = await collectFiles(fs, from);
    directories = await collectDirectories(fs, from);
  } catch (error: unknown) {
    return buildFailureResult('move_directory', error, from);
  }

  const destinationFiles = files.map((path) => rebasePath(from, to, path));
  const destinationDirectories = directories.map((path) => rebasePath(from, to, path));

  return executeMutation(runtime, {
    kind: 'move_directory',
    targets: [from, to, ...files, ...destinationFiles],
    sessionTargets: [
      ...directories,
      ...destinationDirectories,
      ...files,
      ...destinationFiles,
    ],
    apply: async () => {
      await fs.rename(from, to);

      return {
        files: files.map((path) => ({
          path,
          status: 'moved' as const,
          from,
          to,
        })),
        message: `Moved directory ${from} to ${to}.`,
      };
    },
  });
}