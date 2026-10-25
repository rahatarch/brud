import type { IBrudFileSystem } from '../../BrudFileSystem/contracts/index.js';
import { ReadOnlyFacade } from '../../BrudFileSystem/projection/index.js';
import type { IUniversalHistoryService } from '../../UniversalHistory/contracts/index.js';
import type { IServiceLifecycle } from '../../../src/contracts/lifecycle.js';
import { resolveActivationOrder, resolveDeactivationOrder } from '../contracts/activationOrder.js';
import { hasOfficialPluginBrand } from '../contracts/branding.js';
import {
  PluginAuthorizationError,
  PluginDependencyError,
  PluginDuplicateError,
  PluginLifecycleError,
  PluginNotFoundError,
} from '../contracts/errors.js';
import type { IBrudPlugin } from '../contracts/IBrudPlugin.js';
import type { IPluginContext, IPluginLogger } from '../contracts/IPluginContext.js';
import type {
  IPluginManagerService,
  PluginRecord,
} from '../contracts/IPluginManager.js';
import { validatePluginManifest } from '../contracts/manifest.js';
import { PluginContext } from '../contracts/PluginContext.js';
import {
  PluginActiveDependencyError,
  PluginManifestValidationError,
} from './types.js';
import type {
  ActivePluginContextRecord,
  InternalPluginRecord,
  PluginManagerRuntimeDependencies,
} from './types.js';

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function candidatePluginId(value: unknown): string | undefined {
  if (!isUnknownRecord(value)) {
    return undefined;
  }

  const id = value.id;

  return typeof id === 'string' ? id : undefined;
}

class PluginManagerLogger implements IPluginLogger {
  private readonly pluginId: string;

  constructor(pluginId: string) {
    this.pluginId = pluginId;
  }

  public info(message: string, meta?: Record<string, unknown>): void {
    console.info(`[plugin:${this.pluginId}] ${message}`, meta ?? {});
  }

  public warn(message: string, meta?: Record<string, unknown>): void {
    console.warn(`[plugin:${this.pluginId}] ${message}`, meta ?? {});
  }

  public error(message: string, error?: unknown): void {
    console.error(`[plugin:${this.pluginId}] ${message}`, error ?? '');
  }
}

export class PluginManagerService implements IPluginManagerService, IServiceLifecycle {
  private readonly dependencies: PluginManagerRuntimeDependencies;

  private readonly plugins = new Map<string, IBrudPlugin>();

  private readonly records = new Map<string, InternalPluginRecord>();

  private readonly contexts = new Map<string, ActivePluginContextRecord>();

  constructor(dependencies: PluginManagerRuntimeDependencies) {
    this.dependencies = dependencies;
  }

  public register(plugin: IBrudPlugin): void {
    const candidate: unknown = plugin.manifest;
    const validation = validatePluginManifest(candidate, { officialBrandHolder: plugin });
    const pluginId = candidatePluginId(candidate);

    if (!validation.ok) {
      if (
        validation.reason === 'RESERVED_NAMESPACE' ||
        validation.reason === 'OFFICIAL_STATUS'
      ) {
        throw new PluginAuthorizationError({
          pluginId: pluginId ?? 'unknown',
          reason: validation.reason,
        });
      }

      throw new PluginManifestValidationError(validation.error, pluginId);
    }

    const manifest = validation.manifest;

    if (this.records.has(manifest.id)) {
      throw new PluginDuplicateError(manifest.id);
    }

    this.plugins.set(manifest.id, plugin);
    this.records.set(manifest.id, {
      plugin,
      manifest,
      official: hasOfficialPluginBrand(plugin),
      state: 'unloaded',
    });
  }

  public async unregister(pluginId: string): Promise<void> {
    const record = this.records.get(pluginId);

    if (record === undefined) {
      throw new PluginNotFoundError(pluginId);
    }

    const dependents = this.findActiveDependents(pluginId);

    if (dependents.length > 0) {
      throw new PluginActiveDependencyError(pluginId, dependents);
    }

    if (record.state === 'active') {
      try {
        await this.deactivateRecord(record);
      } catch (error: unknown) {
        throw new PluginLifecycleError(pluginId, 'deactivate', error);
      }
    } else if (record.state === 'activating' || record.state === 'deactivating') {
      throw new PluginLifecycleError(
        pluginId,
        'deactivate',
        new Error(`Plugin "${pluginId}" is busy and cannot be unregistered`),
      );
    }

    this.plugins.delete(pluginId);
    this.records.delete(pluginId);
    this.contexts.delete(pluginId);
  }

  public getPlugin(id: string): PluginRecord | undefined {
    const record = this.records.get(id);

    return record === undefined ? undefined : this.toPluginRecord(record);
  }

  public listPlugins(): readonly PluginRecord[] {
    return [...this.records.values()].map((record) => this.toPluginRecord(record));
  }

  public resolveActivationOrder(): readonly string[] {
    return resolveActivationOrder([...this.plugins.values()]);
  }

  public async activateAll(): Promise<void> {
    const order = this.resolveActivationOrder();
    const activated: string[] = [];
    let currentId: string | undefined;

    try {
      for (const pluginId of order) {
        const record = this.records.get(pluginId);

        if (record === undefined || record.state === 'active') {
          continue;
        }

        currentId = pluginId;
        await this.activateRecord(record);
        activated.push(pluginId);
        currentId = undefined;
      }
    } catch (error: unknown) {
      const failingId = currentId ?? order[0] ?? 'unknown';
      const failingRecord = this.records.get(failingId);

      if (failingRecord !== undefined && failingRecord.state !== 'active') {
        failingRecord.state = 'failed';

        if (failingRecord.error === undefined) {
          failingRecord.error = describeError(error);
        }
      }

      await this.rollbackActivated(activated);

      throw new PluginLifecycleError(failingId, 'activate', error);
    }
  }

  public async deactivateAll(): Promise<void> {
    const order = resolveDeactivationOrder(this.resolveActivationOrder());
    let firstError: unknown;
    let firstErrorPluginId: string | undefined;

    for (const pluginId of order) {
      const record = this.records.get(pluginId);

      if (record === undefined || record.state !== 'active') {
        continue;
      }

      try {
        await this.deactivateRecord(record);
      } catch (error: unknown) {
        if (firstError === undefined) {
          firstError = error;
          firstErrorPluginId = pluginId;
        }
      }
    }

    if (firstError !== undefined) {
      throw new PluginLifecycleError(
        firstErrorPluginId ?? order[0] ?? 'unknown',
        'deactivate',
        firstError,
      );
    }
  }

  public async activatePlugin(pluginId: string): Promise<void> {
    const record = this.records.get(pluginId);

    if (record === undefined) {
      throw new PluginNotFoundError(pluginId);
    }

    if (record.state === 'active') {
      return;
    }

    try {
      await this.activateWithDependencies(pluginId, []);
    } catch (error: unknown) {
      const current = this.records.get(pluginId) ?? record;

      if (current.state !== 'active') {
        current.state = 'failed';
        current.error = describeError(error);
        current.activatedAt = undefined;
      }

      if (error instanceof PluginLifecycleError || error instanceof PluginDependencyError) {
        throw error;
      }

      throw new PluginLifecycleError(pluginId, 'activate', error);
    }
  }

  public async deactivatePlugin(pluginId: string): Promise<void> {
    const record = this.records.get(pluginId);

    if (record === undefined) {
      throw new PluginNotFoundError(pluginId);
    }

    if (record.state !== 'active') {
      throw new PluginLifecycleError(
        pluginId,
        'deactivate',
        new Error(`Plugin "${pluginId}" is not active`),
      );
    }

    const dependents = this.findActiveDependents(pluginId);

    if (dependents.length > 0) {
      throw new PluginActiveDependencyError(pluginId, dependents);
    }

    try {
      await this.deactivateRecord(record);
    } catch (error: unknown) {
      throw new PluginLifecycleError(pluginId, 'deactivate', error);
    }
  }

  public async start(): Promise<void> {
    await this.activateAll();
  }

  public async stop(): Promise<void> {
    await this.deactivateAll();
  }

  public async initialize(): Promise<void> {
    await this.activateAll();
  }

  public async dispose(): Promise<void> {
    await this.deactivateAll();
  }

  private async activateWithDependencies(
    pluginId: string,
    path: readonly string[],
    dependentId?: string,
  ): Promise<void> {
    const record = this.records.get(pluginId);

    if (record === undefined) {
      throw new PluginDependencyError({
        pluginId: dependentId ?? pluginId,
        dependencyId: pluginId,
      });
    }

    if (record.state === 'active') {
      return;
    }

    const cycleStart = path.indexOf(pluginId);

    if (cycleStart !== -1) {
      throw new PluginDependencyError({
        pluginId,
        cyclePath: [...path.slice(cycleStart), pluginId],
      });
    }

    const nextPath = [...path, pluginId];

    for (const dependencyId of record.manifest.dependencies ?? []) {
      await this.activateWithDependencies(dependencyId, nextPath, pluginId);
    }

    await this.activateRecord(record);
  }

  private async activateRecord(record: InternalPluginRecord): Promise<void> {
    const pluginId = record.manifest.id;

    if (record.state === 'active') {
      return;
    }

    if (record.state === 'activating' || record.state === 'deactivating') {
      throw new PluginLifecycleError(
        pluginId,
        'activate',
        new Error(`Plugin "${pluginId}" cannot activate from state "${record.state}"`),
      );
    }

    record.state = 'activating';
    record.activatedAt = undefined;
    record.error = undefined;

    const context = this.createContext(record);

    try {
      await record.plugin.activate(context);
    } catch (error: unknown) {
      record.state = 'failed';
      record.error = describeError(error);

      try {
        await context.subscriptions.disposeAll();
      } catch {}

      throw error;
    }

    const activatedAt = new Date().toISOString();

    record.state = 'active';
    record.activatedAt = activatedAt;
    record.error = undefined;

    this.contexts.set(pluginId, {
      pluginId,
      context,
      activatedAt,
    });
  }

  private async deactivateRecord(record: InternalPluginRecord): Promise<void> {
    const pluginId = record.manifest.id;

    record.state = 'deactivating';

    let firstError: unknown;

    try {
      await record.plugin.deactivate?.();
    } catch (error: unknown) {
      firstError = error;
    }

    const entry = this.contexts.get(pluginId);
    this.contexts.delete(pluginId);

    if (entry !== undefined) {
      try {
        await entry.context.subscriptions.disposeAll();
      } catch (error: unknown) {
        if (firstError === undefined) {
          firstError = error;
        }
      }
    }

    record.state = 'unloaded';
    record.activatedAt = undefined;
    record.error = undefined;

    if (firstError !== undefined) {
      throw firstError;
    }
  }

  private async rollbackActivated(activated: readonly string[]): Promise<void> {
    for (let index = activated.length - 1; index >= 0; index -= 1) {
      const pluginId = activated[index];

      if (pluginId === undefined) {
        continue;
      }

      const record = this.records.get(pluginId);

      if (record === undefined || record.state !== 'active') {
        continue;
      }

      try {
        await this.deactivateRecord(record);
      } catch {
        continue;
      }
    }
  }

  private createContext(record: InternalPluginRecord): IPluginContext {
    const pluginId = record.manifest.id;
    const permissions = record.manifest.permissions;

    return new PluginContext({
      pluginId,
      workspaceRoot: this.dependencies.workspaceRoot,
      permissions,
      logger: new PluginManagerLogger(pluginId),
      capabilities: {
        fileSystem: (): IBrudFileSystem => {
          const fileSystem = this.dependencies.fileSystem();

          return permissions.includes('fs:write') ? fileSystem : new ReadOnlyFacade(fileSystem);
        },
        universalHistory: (): IUniversalHistoryService => {
          const accessor = this.dependencies.universalHistory;

          if (accessor === undefined) {
            throw new Error(
              `Universal history service is unavailable for plugin "${pluginId}"`,
            );
          }

          return accessor();
        },
      },
    });
  }

  private findActiveDependents(targetId: string): readonly string[] {
    const dependents: string[] = [];

    for (const record of this.records.values()) {
      if (record.state !== 'active' || record.manifest.id === targetId) {
        continue;
      }

      if (this.dependsOn(record, targetId, new Set<string>())) {
        dependents.push(record.manifest.id);
      }
    }

    return dependents;
  }

  private dependsOn(
    record: InternalPluginRecord,
    targetId: string,
    visited: Set<string>,
  ): boolean {
    for (const dependencyId of record.manifest.dependencies ?? []) {
      if (dependencyId === targetId) {
        return true;
      }

      if (visited.has(dependencyId)) {
        continue;
      }

      visited.add(dependencyId);
      const dependency = this.records.get(dependencyId);

      if (dependency !== undefined && this.dependsOn(dependency, targetId, visited)) {
        return true;
      }
    }

    return false;
  }

  private toPluginRecord(record: InternalPluginRecord): PluginRecord {
    return {
      plugin: record.plugin,
      state: record.state,
      ...(record.activatedAt === undefined ? {} : { activatedAt: record.activatedAt }),
      ...(record.error === undefined ? {} : { error: record.error }),
    };
  }
}
