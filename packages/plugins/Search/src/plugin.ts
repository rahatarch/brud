import type {
  IBrudPlugin,
  IPluginContext,
  OperationResult,
  PluginManifest,
} from '@brud/kernel';
import type { SearchFileSystem } from './fsPort.js';
import { searchFiles } from './fileSearch.js';

/** Declarative plugin metadata. */
export const searchManifest: PluginManifest = {
  id: 'akkhar-labs.plugin.search',
  name: 'Search',
  version: '0.0.1',
  description: 'Registers search_files and exports reusable glob matching.',
  permissions: ['fs:read', 'tools:register'],
};

const SEARCH_FILES_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    patterns: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      description: 'Glob patterns or simple words to match.',
    },
    pattern: {
      type: 'string',
      minLength: 1,
      description: 'Alias for a comma-separated pattern list.',
    },
    excludePatterns: {
      type: 'array',
      items: { type: 'string' },
      description: 'Patterns to skip.',
    },
    exclude: {
      type: 'string',
      description: 'Alias for a comma-separated exclusion list.',
    },
    directory: {
      type: 'string',
      description: 'Workspace-relative directory to search. Omit for the workspace root.',
    },
    scope: {
      type: 'string',
      description: 'Alias for directory.',
    },
    extensions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Only include files with these extensions (for example .ts).',
    },
    recursive: {
      type: 'boolean',
      description: 'Descend into subdirectories. Defaults to true.',
    },
    maxResults: {
      type: 'number',
      description: 'Maximum files to return. Omit for all results.',
    },
  },
  required: ['patterns'],
  additionalProperties: false,
};

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .map(entry => entry.trim())
      .filter(entry => entry.length > 0);
  }

  if (typeof value !== 'string') {
    return [];
  }

  return value
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0);
}

function readLimit(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return Math.floor(value);
}

/**
 * Builds a Search plugin bound to its own activation context.
 */
export function createSearchPlugin(): IBrudPlugin {
  return {
    manifest: searchManifest,
    activate(context: IPluginContext): void {
      const fs: SearchFileSystem = context.getFileSystem();

      context.registerTool({
        name: 'search_files',
        description: 'Find files by name, glob pattern, or extension.',
        parametersSchema: SEARCH_FILES_SCHEMA,
        execute: async (input): Promise<OperationResult> => {
          const patterns = readStringArray(input.patterns);
          const aliasPatterns = readStringArray(input.pattern);
          const effectivePatterns = patterns.length > 0 ? patterns : aliasPatterns;

          if (effectivePatterns.length === 0) {
            return {
              status: 'failed',
              error: 'The field "patterns" must contain at least one pattern.',
            };
          }

          const excludedFromList = readStringArray(input.excludePatterns);
          const excludedFromAlias = readStringArray(input.exclude);
          const excludePatterns = excludedFromList.length > 0
            ? excludedFromList
            : excludedFromAlias;

          const directory = readString(input.directory) ?? readString(input.scope);
          const extensions = readStringArray(input.extensions);
          const recursive = input.recursive === false ? false : true;

          try {
            const response = await searchFiles(fs, {
              patterns: effectivePatterns,
              ...(excludePatterns.length > 0 ? { excludePatterns } : {}),
              ...(extensions.length > 0 ? { extensions } : {}),
              ...(directory === undefined ? {} : { directory }),
              recursive,
              ...(readLimit(input.maxResults) === undefined
                ? {}
                : { maxResults: readLimit(input.maxResults) }),
            });

            return { status: 'success', data: response };
          } catch (error: unknown) {
            return {
              status: 'failed',
              error: error instanceof Error ? error.message : String(error),
            };
          }
        },
      });

      context.logger.info('Search tool registered', { tools: ['search_files'] });
    },
  };
}

/** Shared Search plugin instance. */
export const searchPlugin: IBrudPlugin = createSearchPlugin();

export default searchPlugin;