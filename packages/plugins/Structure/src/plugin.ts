import type { OperationResult } from '@brud/kernel';
import type { IBrudPlugin, IPluginContext, PluginManifest } from '@brud/service-plugin-manager';
import type { StructureFileSystem } from './fsPort.js';
import { extractDirectoryStructure } from './structure.js';
import { extractCodebaseMetadata } from './metadata.js';
import { baseNameRelativePath } from './pathUtils.js';

/** Declarative plugin metadata. */
export const structureManifest: PluginManifest = {
  id: 'akkhar-labs.plugin.structure',
  name: 'Structure',
  version: '0.0.1',
  description: 'Registers extract_structure and codebase_metadata over the kernel filesystem.',
  permissions: ['fs:read', 'tools:register'],
};

const EXTRACT_STRUCTURE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    directoryPath: {
      type: 'string',
      description: 'Workspace-relative directory path to extract. Use an empty string for the workspace root.',
    },
    depth: {
      type: 'number',
      description: 'Depth level. 0 (default) means unlimited.',
      default: 0,
    },
  },
  required: ['directoryPath'],
  additionalProperties: false,
};

const CODEBASE_METADATA_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

function errorResult(error: unknown): OperationResult {
  return {
    status: 'failed',
    error: error instanceof Error ? error.message : String(error),
  };
}

function readNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return value;
}

/**
 * Builds a Structure plugin bound to its own activation context.
 *
 * The filesystem handle is acquired during `activate` and captured by both
 * tool handlers, so each registration is scoped to this plugin instance.
 */
export function createStructurePlugin(): IBrudPlugin {
  return {
    manifest: structureManifest,
    activate(context: IPluginContext): void {
      const fs: StructureFileSystem = context.getFileSystem();
      const workspaceRoot = context.workspaceRoot;

      context.registerTool({
        name: 'extract_structure',
        description: 'Generate a token-efficient JSON map of a directory with file line counts and depth control.',
        parametersSchema: EXTRACT_STRUCTURE_SCHEMA,
        execute: async (input): Promise<OperationResult> => {
          const directoryPath = typeof input.directoryPath === 'string' ? input.directoryPath : '';
          const depth = readNumber(input.depth, 0);
          const rootLabel = baseNameRelativePath(workspaceRoot) || 'workspace';

          try {
            const structure = await extractDirectoryStructure(fs, directoryPath, depth, { rootLabel });
            return {
              status: 'success',
              data: { directoryPath, depth, structure },
            };
          } catch (error: unknown) {
            return errorResult(error);
          }
        },
      });

      context.registerTool({
        name: 'codebase_metadata',
        description: 'Get a quick summary of codebase scale and density.',
        parametersSchema: CODEBASE_METADATA_SCHEMA,
        execute: async (): Promise<OperationResult> => {
          const rootLabel = baseNameRelativePath(workspaceRoot) || 'workspace';

          try {
            const metadata = await extractCodebaseMetadata(fs, '', rootLabel);
            return { status: 'success', data: metadata };
          } catch (error: unknown) {
            return errorResult(error);
          }
        },
      });

      context.logger.info('Structure tools registered', {
        tools: ['extract_structure', 'codebase_metadata'],
      });
    },
  };
}

/** Shared Structure plugin instance. */
export const structurePlugin: IBrudPlugin = createStructurePlugin();

export default structurePlugin;