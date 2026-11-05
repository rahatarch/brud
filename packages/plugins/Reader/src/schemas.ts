/**
 * Parameter schemas for the Reader tools.
 *
 * The wire surface intentionally matches the legacy `ToolDoc` registrations:
 * one documented field set per tool, no internal-only fields, and no extra
 * properties. Numeric and boolean values may arrive as strings from the
 * protocol parser; the handlers normalize those at execution time without
 * widening the registered schema.
 */

/** Accepted payload for `read_file`. */
export interface ReadFileInput {
  readonly filePath?: unknown;
  readonly isImportRead?: unknown;
  readonly maxDepth?: unknown;
  readonly importSyntax?: unknown;
  readonly exclude?: unknown;
  readonly startLine?: unknown;
  readonly endLine?: unknown;
}

/** Accepted payload for `read_files`. */
export interface ReadFilesInput {
  readonly pattern?: unknown;
  readonly scope?: unknown;
  readonly maxResults?: unknown;
  readonly isImportRead?: unknown;
}

/** Accepted payload for `read_directory`. */
export interface ReadDirectoryInput {
  readonly directoryPath?: unknown;
  readonly recursive?: unknown;
  readonly exclude?: unknown;
}

/** Schema for `read_file`. */
export const READ_FILE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    filePath: {
      type: 'string',
      description: 'File path to read',
    },
    isImportRead: {
      type: 'boolean',
      description: 'Follow imports recursively',
      default: false,
    },
    maxDepth: {
      type: 'number',
      description: 'How deep to follow imports. 0 for unlimited.',
      default: 0,
    },
    importSyntax: {
      type: 'string',
      description: 'Custom import pattern regex',
    },
    exclude: {
      type: 'string',
      description: 'Patterns to skip when following imports',
    },
    startLine: {
      type: 'number',
      description: '1-based starting line number (defaults to 1)',
    },
    endLine: {
      type: 'number',
      description: '1-based ending line number (inclusive; auto-clamps to EOF if beyond file length)',
    },
  },
  required: ['filePath'],
  additionalProperties: false,
};

/** Schema for `read_files`. */
export const READ_FILES_SCHEMA: Record<string, unknown> = {
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
    maxResults: {
      type: 'number',
      description: 'Maximum files to return. Not set returns all results.',
    },
    isImportRead: {
      type: 'boolean',
      description: 'Follow imports',
      default: false,
    },
  },
  required: ['pattern'],
  additionalProperties: false,
};

/** Schema for `read_directory`. */
export const READ_DIRECTORY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    directoryPath: {
      type: 'string',
      description: 'Directory to read',
    },
    recursive: {
      type: 'boolean',
      description: 'Read subdirectories',
      default: false,
    },
    exclude: {
      type: 'string',
      description: 'Glob patterns to skip',
    },
  },
  required: ['directoryPath'],
  additionalProperties: false,
};