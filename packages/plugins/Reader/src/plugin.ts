import type {
  IBrudPlugin,
  IPluginContext,
  OperationResult,
  PluginManifest,
  PluginPermission,
} from '@brud/kernel';
import { summarizeReadResult } from './envelope.js';
import type { ReadResult } from './envelope.js';
import { GovernorError } from './governor.js';
import {
  ReadInputError,
  SearchExecutionError,
  readDirectory,
  readFile,
  readFiles,
} from './readEngine.js';
import type { ReaderRuntime } from './readEngine.js';
import {
  READ_DIRECTORY_SCHEMA,
  READ_FILES_SCHEMA,
  READ_FILE_SCHEMA,
} from './schemas.js';

/** Declarative plugin metadata. */
export const readerManifest: PluginManifest = {
  id: 'akkhar-labs.plugin.reader',
  name: 'Reader',
  version: '0.0.1',
  description: 'Registers read_file, read_files, and read_directory over the kernel filesystem, Search, and the utility resolver.',
  permissions: ['fs:read', 'tools:register', 'tools:execute'],
};

const REQUIRED_PERMISSIONS: readonly PluginPermission[] = [
  'fs:read',
  'tools:register',
  'tools:execute',
];

type ReaderOperationResult = OperationResult & { readonly code?: string };

function assertRequiredPermissions(context: IPluginContext): void {
  const missing = REQUIRED_PERMISSIONS.filter(
    (permission) => !context.hasPermission(permission),
  );

  if (missing.length > 0) {
    throw new Error(
      `Reader plugin requires permissions: ${missing.join(', ')}`,
    );
  }
}

function errorCodeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  const code = (error as { readonly code?: unknown }).code;

  return typeof code === 'string' ? code : undefined;
}

function ruleOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('rule' in error)) {
    return undefined;
  }

  const rule = (error as { readonly rule?: unknown }).rule;

  return typeof rule === 'string' ? rule : undefined;
}

function detailsOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('details' in error)) {
    return undefined;
  }

  const details = (error as { readonly details?: unknown }).details;

  return typeof details === 'string' ? details : undefined;
}

function failureResult(error: unknown): ReaderOperationResult {
  const code = error instanceof GovernorError
    ? 'BATCH_LIMIT_EXCEEDED'
    : error instanceof SearchExecutionError
      ? 'SEARCH_FAILED'
      : error instanceof ReadInputError
        ? 'INVALID_FIELD'
        : errorCodeOf(error) ?? 'READ_ERROR';
  const message = error instanceof Error ? error.message : String(error);
  const rule = ruleOf(error);
  const details = detailsOf(error);

  return {
    status: 'failed',
    error: `${code}: ${message}`,
    message,
    code,
    data: {
      code,
      ...(rule === undefined ? {} : { rule }),
      ...(details === undefined ? {} : { details }),
    },
  };
}

function successResult(result: ReadResult, signal: AbortSignal | undefined): ReaderOperationResult {
  const message = summarizeReadResult(result);

  if (signal?.aborted === true) {
    return { status: 'aborted', data: result, message };
  }

  return { status: 'success', data: result, message };
}

/**
 * Builds the Reader plugin instance.
 *
 * Capability handles are acquired during activation and captured by every
 * handler, so each registration is scoped to the plugin that owns it.
 */
export function createReaderPlugin(): IBrudPlugin {
  return {
    manifest: readerManifest,
    activate(context: IPluginContext): void {
      assertRequiredPermissions(context);

      const fs = context.getFileSystem();
      const utilities = context.getUtilities();
      const workspaceRoot = context.workspaceRoot;

      const createRuntime = (signal: AbortSignal | undefined): ReaderRuntime => ({
        fs,
        utilities,
        workspaceRoot,
        executeTool: (name, input, contextOverride) =>
          context.executeTool(name, input, contextOverride),
        ...(signal === undefined ? {} : { signal }),
      });

      context.registerTool({
        name: 'read_file',
        description: 'Read a file with optional import following',
        parametersSchema: READ_FILE_SCHEMA,
        execute: async (input, execContext): Promise<OperationResult> => {
          try {
            const result = await readFile(createRuntime(execContext.signal), input);
            return successResult(result, execContext.signal);
          } catch (error: unknown) {
            return failureResult(error);
          }
        },
      });

      context.registerTool({
        name: 'read_files',
        description: 'Read files matching a pattern',
        parametersSchema: READ_FILES_SCHEMA,
        execute: async (input, execContext): Promise<OperationResult> => {
          try {
            const result = await readFiles(createRuntime(execContext.signal), input);
            return successResult(result, execContext.signal);
          } catch (error: unknown) {
            return failureResult(error);
          }
        },
      });

      context.registerTool({
        name: 'read_directory',
        description: 'Read all files in a directory',
        parametersSchema: READ_DIRECTORY_SCHEMA,
        execute: async (input, execContext): Promise<OperationResult> => {
          try {
            const result = await readDirectory(createRuntime(execContext.signal), input);
            return successResult(result, execContext.signal);
          } catch (error: unknown) {
            return failureResult(error);
          }
        },
      });

      context.logger.info('Reader tools registered', {
        tools: ['read_file', 'read_files', 'read_directory'],
      });
    },
  };
}

/** Shared Reader plugin instance. */
export const readerPlugin: IBrudPlugin = createReaderPlugin();

export default readerPlugin;