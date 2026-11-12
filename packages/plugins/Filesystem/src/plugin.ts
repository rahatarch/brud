import type { OperationResult } from '@brud/kernel';
import type { IBrudPlugin, IPluginContext } from '@brud/service-plugin-manager';
import { SHARED_MUTEX } from './coordinator/index.js';
import { filesystemManifest } from './manifest.js';
import type { FilesystemRuntime } from './runtime.js';

import {
  CREATE_DIRECTORY_SCHEMA,
  createDirectory,
} from './groups/directory/createDirectory/index.js';
import {
  DELETE_DIRECTORY_SCHEMA,
  deleteDirectory,
} from './groups/directory/deleteDirectory/index.js';
import {
  MOVE_DIRECTORY_SCHEMA,
  moveDirectory,
} from './groups/directory/moveDirectory/index.js';
import {
  APPEND_FILE_SCHEMA,
  appendFile,
} from './groups/file/appendFile/index.js';
import {
  COPY_FILE_SCHEMA,
  copyFile,
} from './groups/file/copyFile/index.js';
import {
  CREATE_FILE_SCHEMA,
  createFile,
} from './groups/file/createFile/index.js';
import {
  DELETE_FILE_SCHEMA,
  deleteFile,
} from './groups/file/deleteFile/index.js';
import {
  MOVE_FILE_SCHEMA,
  moveFile,
} from './groups/file/moveFile/index.js';
import {
  RENAME_FILE_SCHEMA,
  renameFile,
} from './groups/file/renameFile/index.js';
import {
  APPEND_FILE_MULTI_SCHEMA,
  appendFileMulti,
} from './groups/multi/appendFileMulti/index.js';
import {
  SEARCH_REPLACE_SCHEMA,
  searchReplace,
} from './groups/multi/searchReplace/index.js';
import {
  SEARCH_REPLACE_MULTI_SCHEMA,
  searchReplaceMulti,
} from './groups/multi/searchReplaceMulti/index.js';

interface ToolDefinition {
  name: string;
  description: string;
  parametersSchema: Record<string, unknown>;
  handler: (
    input: Record<string, unknown>,
    runtime: FilesystemRuntime,
  ) => Promise<OperationResult>;
}

const TOOLS: readonly ToolDefinition[] = [
  {
    name: 'create_file',
    description: 'Create a new file with specified content',
    parametersSchema: CREATE_FILE_SCHEMA,
    handler: createFile,
  },
  {
    name: 'delete_file',
    description: 'Remove a file from the filesystem',
    parametersSchema: DELETE_FILE_SCHEMA,
    handler: deleteFile,
  },
  {
    name: 'rename_file',
    description: 'Rename a file from one name to another',
    parametersSchema: RENAME_FILE_SCHEMA,
    handler: renameFile,
  },
  {
    name: 'move_file',
    description: 'Move a file from one location to another',
    parametersSchema: MOVE_FILE_SCHEMA,
    handler: moveFile,
  },
  {
    name: 'copy_file',
    description: 'Copy a file from one location to another',
    parametersSchema: COPY_FILE_SCHEMA,
    handler: copyFile,
  },
  {
    name: 'append_file',
    description: 'Append content to the end of an existing file',
    parametersSchema: APPEND_FILE_SCHEMA,
    handler: appendFile,
  },
  {
    name: 'create_directory',
    description: 'Create a new directory with optional empty files',
    parametersSchema: CREATE_DIRECTORY_SCHEMA,
    handler: createDirectory,
  },
  {
    name: 'delete_directory',
    description: 'Remove a directory and all its contents',
    parametersSchema: DELETE_DIRECTORY_SCHEMA,
    handler: deleteDirectory,
  },
  {
    name: 'move_directory',
    description: 'Move a directory from one location to another',
    parametersSchema: MOVE_DIRECTORY_SCHEMA,
    handler: moveDirectory,
  },
  {
    name: 'append_file_multi',
    description: 'Append content to multiple files matching a pattern',
    parametersSchema: APPEND_FILE_MULTI_SCHEMA,
    handler: appendFileMulti,
  },
  {
    name: 'search_replace',
    description: 'Search for existing content and replace it with new content',
    parametersSchema: SEARCH_REPLACE_SCHEMA,
    handler: searchReplace,
  },
  {
    name: 'search_replace_multi',
    description: 'Search and replace text across multiple files',
    parametersSchema: SEARCH_REPLACE_MULTI_SCHEMA,
    handler: searchReplaceMulti,
  },
];

/**
 * Activates the plugin and registers the twelve mutation tools.
 *
 * Capability handles are acquired once here and captured by every handler.
 */
export function activateFilesystem(context: IPluginContext): void {
  const fs = context.getFileSystem();
  const history = context.getUniversalHistory();
  const executeTool = context.executeTool.bind(context);
  const runtime: FilesystemRuntime = {
    getFileSystem: () => fs,
    getUniversalHistory: () => history,
    executeTool,
    mutex: SHARED_MUTEX,
    workspaceRoot: context.workspaceRoot,
  };

  for (const tool of TOOLS) {
    context.registerTool({
      name: tool.name,
      description: tool.description,
      parametersSchema: tool.parametersSchema,
      execute: (input): Promise<OperationResult> => tool.handler(input, runtime),
    });
  }

  context.logger.info('Filesystem tools registered', {
    tools: TOOLS.map((tool) => tool.name),
  });
}

/** Builds a Filesystem plugin instance. */
export function createFilesystemPlugin(): IBrudPlugin {
  return {
    manifest: filesystemManifest,
    activate: (context: IPluginContext): void => {
      activateFilesystem(context);
    },
  };
}

/** Shared Filesystem plugin instance. */
export const filesystemPlugin: IBrudPlugin = createFilesystemPlugin();

export { filesystemManifest };

export default filesystemPlugin;