import { readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import v8 from 'node:v8';
import {
  BrudToolsService,
  BrudToolsToken,
  CORE_API_NAME,
  ExposedApiRegistryService,
  PluginContext,
  PluginManagerService,
  PluginManagerToken,
  createRegistryCapabilityProviders,
  createStandardKernel,
  lastProjectionWins,
} from '@brud/kernel';
import type {
  BrudKernel,
  IBrudPlugin,
  IBrudToolsService,
  IKernelAccessBroker,
  InternalPluginRecord,
  IPluginDisposable,
  OperationResult,
  PluginManifest,
  PluginPermission,
  RegisteredToolInfo,
  ServiceContext,
  ServiceInfo,
  ServiceToken,
  ToolRegistrationOptions,
} from '@brud/kernel';
import { CATALOG_MANDATE, catalogPlugin, sanitizeDescription } from '../plugin.js';

export { CATALOG_MANDATE, sanitizeDescription };

export const DEFAULT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

export const LEGACY_MANDATE = '\n\n**CRITICAL MANDATE:**\nDo NOT attempt to invoke, execute, or guess the syntax of any tool above based on its name or description alone. You have NOT been provided with their parameter schemas or block syntax. You MUST call `GET_TOOL_INFO` with `Tool: <kind>` (e.g. `Tool: [tool_name]`) to retrieve the exact required fields, behavioral rules, and copy-paste template BEFORE generating any execution instructions.';



export const LEGACY_TOOL_KINDS: readonly string[] = [
  'search_replace',
  'create_file',
  'delete_file',
  'rename_file',
  'move_file',
  'copy_file',
  'append_file',
  'append_file_multi',
  'search_replace_multi',
  'create_directory',
  'delete_directory',
  'move_directory',
  'extract_structure',
  'codebase_metadata',
  'search_files',
  'read_file',
  'read_files',
  'read_directory',
  'terminal_interactive',
  'terminal_command',
];

export const LEGACY_OPERATIONS: readonly string[] = [...LEGACY_TOOL_KINDS, 'get_tool_info'];

export const LEGACY_TO_NEW: Readonly<Record<string, string | null>> = Object.freeze({
  search_replace: null,
  create_file: null,
  delete_file: null,
  rename_file: null,
  move_file: null,
  copy_file: null,
  append_file: null,
  append_file_multi: null,
  search_replace_multi: null,
  create_directory: null,
  delete_directory: null,
  move_directory: null,
  extract_structure: 'extract_structure',
  codebase_metadata: 'codebase_metadata',
  search_files: 'search_files',
  read_file: null,
  read_files: null,
  read_directory: null,
  terminal_interactive: null,
  terminal_command: null,
  get_tool_info: 'get_tool_info',
});

export interface LeafFixture {
  readonly name: string;
  readonly description: string;
  readonly schema: Record<string, unknown>;
}

export const LEAF_FIXTURES: readonly LeafFixture[] = Object.freeze([
  {
    name: 'extract_structure',
    description: 'Generate a token-efficient JSON map of a directory with file line counts and depth control.',
    schema: {
      type: 'object',
      properties: {
        directoryPath: { type: 'string', description: 'Workspace-relative directory path.' },
        depth: { type: 'number', description: 'Depth level.' },
      },
      required: ['directoryPath'],
      additionalProperties: false,
    },
  },
  {
    name: 'codebase_metadata',
    description: 'Get a quick summary of codebase scale and density.',
    schema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'search_files',
    description: 'Find files by name, glob pattern, or extension.',
    schema: {
      type: 'object',
      properties: {
        patterns: { type: 'array', items: { type: 'string' }, minItems: 1 },
        recursive: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
]);

export interface CatalogKernel {
  readonly kernel: BrudKernel;
  readonly root: string;
  readonly caller: ServiceContext;
  readonly tools: IBrudToolsService;
  readonly manager: PluginManagerService;
  readonly cleanup: () => Promise<void>;
}

export function makeCaller(root: string, callerId = 'test.catalog'): ServiceContext {
  return { callerId, tier: 'core', workspaceRoot: root };
}

export async function bootCatalogKernel(
  extraPlugins: readonly IBrudPlugin[] = [],
): Promise<CatalogKernel> {
  const root = await mkdtemp(join(tmpdir(), 'brud-catalog-verify-'));
  const kernel = createStandardKernel({
    initialPlugins: [catalogPlugin, ...extraPlugins],
    history: { inMemory: true },
  });

  await kernel.boot({ options: { workspaceRoot: root } });

  const caller = makeCaller(root);
  const tools = kernel.requestAccess(caller, BrudToolsToken);
  const manager = kernel.requestAccess(caller, PluginManagerToken) as PluginManagerService;

  return {
    kernel,
    root,
    caller,
    tools,
    manager,
    cleanup: async (): Promise<void> => {
      await kernel.shutdown();
      await rm(root, { recursive: true, force: true });
    },
  };
}

export async function callCatalog(
  tools: IBrudToolsService,
  root: string,
  input: Record<string, unknown>,
  callerId = 'test.catalog',
): Promise<OperationResult> {
  return tools.executeTool('get_tool_info', input, {
    workspaceRoot: root,
    callerId,
    permissions: ['tools:register'],
  });
}

export interface FixtureToolOptions {
  readonly name: string;
  readonly description?: string;
  readonly schema?: Record<string, unknown>;
  readonly pluginId?: string;
  readonly isOfficial?: boolean;
  readonly requiredPermissions?: readonly string[];
  readonly execute?: ToolRegistrationOptions['execute'];
}

export function registerFixture(
  tools: IBrudToolsService,
  options: FixtureToolOptions,
): IPluginDisposable {
  return tools.registerTool(
    options.pluginId ?? 'test.fixture',
    options.isOfficial ?? false,
    {
      name: options.name,
      description: options.description ?? `Fixture tool ${options.name}`,
      parametersSchema: options.schema ?? DEFAULT_SCHEMA,
      ...(options.requiredPermissions === undefined
        ? {}
        : { requiredPermissions: options.requiredPermissions }),
      execute: options.execute ?? (async (): Promise<OperationResult> => ({ status: 'success' })),
    },
  );
}

export function registerLeafFixtures(tools: IBrudToolsService): void {
  for (const fixture of LEAF_FIXTURES) {
    registerFixture(tools, {
      name: fixture.name,
      description: fixture.description,
      schema: fixture.schema,
      pluginId: `test.leaf.${fixture.name}`,
    });
  }
}

export interface SyntheticPluginTool {
  readonly name: string;
  readonly description?: string;
  readonly schema?: Record<string, unknown>;
  readonly requiredPermissions?: readonly string[];
  readonly execute?: ToolRegistrationOptions['execute'];
}

export interface SyntheticPluginOptions {
  readonly permissions?: readonly PluginPermission[];
  readonly onActivate?: (pluginId: string) => void;
  readonly onDeactivate?: () => Promise<void> | void;
}

export function makeToolPlugin(
  id: string,
  pluginTools: readonly SyntheticPluginTool[],
  options: SyntheticPluginOptions = {},
): IBrudPlugin {
  const manifest: PluginManifest = {
    id,
    name: `Synthetic ${id}`,
    version: '1.0.0',
    permissions: [...(options.permissions ?? ['tools:register'])],
  };

  return {
    manifest,
    activate(context): void {
      for (const tool of pluginTools) {
        context.registerTool({
          name: tool.name,
          description: tool.description ?? `Synthetic tool ${tool.name}`,
          parametersSchema: tool.schema ?? DEFAULT_SCHEMA,
          ...(tool.requiredPermissions === undefined
            ? {}
            : { requiredPermissions: tool.requiredPermissions }),
          execute: tool.execute ?? (async (): Promise<OperationResult> => ({ status: 'success' })),
        });
      }

      options.onActivate?.(id);
    },
    ...(options.onDeactivate === undefined ? {} : { deactivate: options.onDeactivate }),
  };
}

export function makeFailingActivationPlugin(id: string, tools: readonly SyntheticPluginTool[]): IBrudPlugin {
  return {
    manifest: {
      id,
      name: `Failing ${id}`,
      version: '1.0.0',
      permissions: ['tools:register'],
    },
    activate(context): void {
      for (const tool of tools) {
        context.registerTool({
          name: tool.name,
          description: tool.description ?? `Synthetic tool ${tool.name}`,
          parametersSchema: tool.schema ?? DEFAULT_SCHEMA,
          execute: tool.execute ?? (async (): Promise<OperationResult> => ({ status: 'success' })),
        });
      }

      throw new Error(`synthetic activation failure for ${id}`);
    },
  };
}

class CatalogServiceBroker implements IKernelAccessBroker {
  constructor(private readonly brudTools: IBrudToolsService | undefined) {}

  requestAccess<TService>(caller: ServiceContext, token: ServiceToken<TService>): TService {
    void caller;

    if (token.id === BrudToolsToken.id && this.brudTools !== undefined) {
      return this.brudTools as TService;
    }

    throw new Error(`Service "${token.id}" is not registered`);
  }

  hasService(token: ServiceToken<unknown>): boolean {
    return token.id === BrudToolsToken.id && this.brudTools !== undefined;
  }

  listServices(): readonly ServiceInfo[] {
    return Object.freeze([]);
  }
}

export function makePluginContext(
  brudTools: IBrudToolsService | undefined,
  permissions: readonly PluginPermission[],
  pluginId = 'test.context.plugin',
): PluginContext {
  const broker = new CatalogServiceBroker(brudTools);
  const registry = new ExposedApiRegistryService({
    broker,
    callerContext: {
      callerId: 'test.api.registry',
      tier: 'core',
      workspaceRoot: '/workspace',
    },
  });

  if (brudTools !== undefined) {
    registry.registerApi(CORE_API_NAME.brudTools, BrudToolsToken, {
      capability: 'tools:register',
      combine: lastProjectionWins,
    });
    registry.registerApi(CORE_API_NAME.brudTools, BrudToolsToken, {
      capability: 'tools:execute',
      combine: lastProjectionWins,
    });
  }

  registry.closeRegistration();

  const manifest: PluginManifest = {
    id: pluginId,
    name: pluginId,
    version: '1.0.0',
    permissions: [...permissions],
  };
  const record: InternalPluginRecord = {
    plugin: { manifest, activate: (): void => undefined },
    manifest,
    official: false,
    state: 'unloaded',
  };

  return new PluginContext({
    pluginId,
    workspaceRoot: '/workspace',
    permissions,
    logger: {
      info: (): void => undefined,
      warn: (): void => undefined,
      error: (): void => undefined,
    },
    capabilities: createRegistryCapabilityProviders(
      registry,
      record,
      permissions,
      '/workspace',
    ),
  });
}

export function newToolsService(): BrudToolsService {
  return new BrudToolsService();
}

export interface PopulateOptions {
  readonly perPlugin?: number;
  readonly schema?: (index: number) => Record<string, unknown>;
  readonly description?: (index: number) => string;
  readonly name?: (index: number) => string;
}

export function populateTools(
  tools: IBrudToolsService,
  count: number,
  options: PopulateOptions = {},
): string[] {
  const perPlugin = options.perPlugin ?? 100;
  const names: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const name = options.name?.(index) ?? `bulk_tool_${index}`;
    names.push(name);

    tools.registerTool(
      `bulk.plugin.${Math.floor(index / perPlugin)}`,
      false,
      {
        name,
        description: options.description?.(index) ?? `Bulk tool ${index}`,
        parametersSchema: options.schema?.(index) ?? DEFAULT_SCHEMA,
        execute: async (): Promise<OperationResult> => ({ status: 'success' }),
      },
    );
  }

  return names;
}

export function deferred<T = void>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

let gcFunction: (() => void) | undefined;

export function forceGc(): void {
  if (gcFunction === undefined) {
    v8.setFlagsFromString('--expose-gc');
    gcFunction = vm.runInNewContext('gc') as () => void;
  }

  gcFunction();
}

export function heapUsed(): number {
  return process.memoryUsage().heapUsed;
}

export function bestOfMs(runs: number, operation: () => void): number {
  let best = Number.POSITIVE_INFINITY;

  for (let index = 0; index < runs; index += 1) {
    const start = performance.now();
    operation();
    const elapsed = performance.now() - start;

    if (elapsed < best) {
      best = elapsed;
    }
  }

  return best;
}

export function fdCount(): number | undefined {
  try {
    return readdirSync('/proc/self/fd').length;
  } catch {
    return undefined;
  }
}

export function toolNames(tools: readonly RegisteredToolInfo[]): string[] {
  return tools.map((tool) => tool.name);
}