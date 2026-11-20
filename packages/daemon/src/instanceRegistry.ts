import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type * as KernelApi from '@brud/kernel' with { 'resolution-mode': 'import' };
import type { BrudKernel, ContextSchema } from '@brud/kernel' with { 'resolution-mode': 'import' };
import type { DaemonOperatorConfig } from './operatorConfig.js';

type KernelModule = typeof KernelApi;

let kernelModulePromise: Promise<KernelModule> | undefined;

/** Loads `@brud/kernel` once (ESM, cached). */
export function loadKernelModule(): Promise<KernelModule> {
  kernelModulePromise ??= import('@brud/kernel');
  return kernelModulePromise;
}

/** Kernel-owned startup fields the daemon fills from its own home. */
export const IDENTITY_REGISTRY_PATH_FIELD = 'identity.registry.path';
export const EXPOSED_API_SCOPE_RECORD_FIELD = 'exposedApi.scopeRecord.path';

/** Lifecycle of one hosted kernel. */
export type KernelInstanceState = 'booting' | 'running' | 'shutting-down' | 'disposed';

/** A participant the kernel left out because required startup fields were missing. */
export interface PrunedParticipants {
  readonly participants: readonly string[];
  readonly path: string;
  readonly missingFields: readonly string[];
}

type KernelLogger = { warn(message: string, meta?: Record<string, unknown>): void };

/** A boot logger that records the kernel's pruning reports and forwards the rest. */
function pruneRecorder(forward: KernelLogger | undefined): { readonly logger: KernelLogger & Record<string, unknown>; readonly pruned: PrunedParticipants[] } {
  const pruned: PrunedParticipants[] = [];
  const logger = {
    warn(message: string, meta?: Record<string, unknown>): void {
      const detail = meta as Partial<PrunedParticipants> | undefined;

      if (detail !== undefined && Array.isArray(detail.participants) && Array.isArray(detail.missingFields)) {
        pruned.push({
          participants: [...detail.participants],
          path: String(detail.path ?? ''),
          missingFields: [...detail.missingFields],
        });
        return;
      }

      forward?.warn(message, meta);
    },
    info: (): void => undefined,
    debug: (): void => undefined,
    error(message: string, meta?: Record<string, unknown>): void {
      forward?.warn(message, meta);
    },
  };

  return { logger, pruned };
}

/** One kernel the daemon hosts. */
export interface KernelInstance {
  readonly id: string;
  /** Hash of the client-supplied options; names the instance's state folder. */
  readonly key: string;
  readonly kernel: BrudKernel;
  readonly clients: Set<string>;
  state: KernelInstanceState;
  lastUsedAt: Date;
  /** Participants the kernel left out at boot (missing required fields). */
  readonly pruned: readonly PrunedParticipants[];
}

/** A required startup field, as collected from the composition. */
export interface RequirementField {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly description?: string;
  readonly service: string;
}

/** Raised when a client sets a startup field the operator did not allow. */
export class BootOptionNotAllowedError extends Error {
  readonly code = 'BOOT_OPTION_NOT_ALLOWED';

  constructor(readonly field: string) {
    super(`The operator does not allow clients to set startup field "${field}"`);
    this.name = 'BootOptionNotAllowedError';
  }
}

/** Raised for an instance id that is unknown or not attached to the client. */
export class KernelInstanceNotFoundError extends Error {
  readonly code = 'KERNEL_INSTANCE_NOT_FOUND';

  constructor(readonly instanceId: string) {
    super(`No kernel instance "${instanceId}" is attached to this connection`);
    this.name = 'KernelInstanceNotFoundError';
  }
}

export interface KernelInstanceRegistryOptions {
  /** Daemon home: the operator's state folder. */
  readonly home: string;
  readonly operator: DaemonOperatorConfig;
  /** Dispose a kernel with no attached clients after this long; 0 disables. */
  readonly idleTimeoutMs?: number;
  readonly now?: () => number;
  readonly logger?: { warn(message: string, meta?: Record<string, unknown>): void };
}

/** Default idle window for a kernel with no clients. */
export const DEFAULT_INSTANCE_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (typeof value === 'object' && value !== null) {
    const entries = Object.keys(value as Record<string, unknown>).sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`);

    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value) ?? 'null';
}

/**
 * The daemon's kernels. It knows no participant and no domain: startup options
 * are the operator's fixed options plus the client's allowed ones, validated by
 * the kernel's own context contract at boot.
 */
export class KernelInstanceRegistry {
  private readonly instances = new Map<string, KernelInstance>();

  private readonly pending = new Map<string, Promise<KernelInstance>>();

  private readonly home: string;

  private readonly operator: DaemonOperatorConfig;

  private readonly idleTimeoutMs: number;

  private readonly now: () => number;

  private readonly logger: KernelInstanceRegistryOptions['logger'];

  private sweepTimer: NodeJS.Timeout | undefined;

  private disposed = false;

  constructor(options: KernelInstanceRegistryOptions) {
    this.home = options.home;
    this.operator = options.operator;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_INSTANCE_IDLE_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
    this.logger = options.logger;

    if (this.idleTimeoutMs > 0) {
      this.sweepTimer = setInterval(() => {
        void this.sweepIdle();
      }, Math.min(this.idleTimeoutMs, 60_000));
      this.sweepTimer.unref();
    }
  }

  /** Startup fields a client may set. */
  get clientSettableFields(): readonly string[] {
    return this.operator.clientOptions;
  }

  /** Host-session capabilities for an authenticated principal. */
  capabilitiesFor(principal: 'ui' | 'ai'): readonly string[] {
    return this.operator.principals[principal];
  }

  /**
   * The composition's declared startup fields. Boots a throwaway kernel with
   * only the operator's options: the context contract refuses it before any
   * participant is constructed when a required field is missing, and the
   * collected declarations are read either way.
   */
  async requirements(): Promise<readonly RequirementField[]> {
    const kernelModule = await loadKernelModule();
    const scratch = join(this.home, 'requirements', randomUUID());
    const recorder = pruneRecorder(undefined);
    const kernel = kernelModule.createDeferredKernel(this.operator.composition, {});
    let schema: ContextSchema = { locked: false, fields: [] };

    try {
      await kernel.boot({ options: this.kernelOptions(scratch, {}, kernelModule), logger: recorder.logger as never });
      schema = kernel.getContextSchema();
      await kernel.shutdown().catch(() => undefined);
    } catch {
      // A refusal still leaves the collected declarations readable.
      schema = kernel.getContextSchema();
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }

    const fields: RequirementField[] = schema.fields.map((field) => ({
      name: field.name,
      type: String(field.type),
      required: field.required === true,
      ...(field.description === undefined ? {} : { description: field.description }),
      service: field.service,
    }));

    // Fields of participants the kernel left out are withdrawn from the
    // schema; the pruning report still names them.
    for (const entry of recorder.pruned) {
      for (const name of entry.missingFields) {
        if (!fields.some((field) => field.name === name)) {
          fields.push({ name, type: 'unknown', required: true, service: entry.path });
        }
      }
    }

    return fields;
  }

  /** Boots (or, if the operator allows, reuses) a kernel for one client. */
  async boot(
    clientOptions: Readonly<Record<string, unknown>>,
    clientId: string,
  ): Promise<{ readonly instance: KernelInstance; readonly reused: boolean }> {
    if (this.disposed) {
      throw new Error('The kernel instance registry has been disposed');
    }

    for (const field of Object.keys(clientOptions)) {
      if (!this.operator.clientOptions.includes(field)) {
        throw new BootOptionNotAllowedError(field);
      }
    }

    const key = createHash('sha256').update(stableStringify(clientOptions)).digest('hex').slice(0, 32);

    if (this.operator.reuseIdenticalBoots) {
      const existing = [...this.instances.values()].find((entry) => entry.key === key && entry.state === 'running');

      if (existing !== undefined) {
        this.attach(existing.id, clientId);
        return { instance: existing, reused: true };
      }

      const inFlight = this.pending.get(key);

      if (inFlight !== undefined) {
        const instance = await inFlight;
        this.attach(instance.id, clientId);
        return { instance, reused: true };
      }
    }

    const creation = this.create(key, clientOptions);

    if (this.operator.reuseIdenticalBoots) {
      this.pending.set(key, creation);
    }

    try {
      const instance = await creation;
      this.attach(instance.id, clientId);
      return { instance, reused: false };
    } finally {
      this.pending.delete(key);
    }
  }

  private async create(key: string, clientOptions: Readonly<Record<string, unknown>>): Promise<KernelInstance> {
    const kernelModule = await loadKernelModule();
    const recorder = pruneRecorder(this.logger);
    const kernel = await kernelModule.bootKernel(this.operator.composition, {
      options: this.kernelOptions(join(this.home, 'kernels', key), clientOptions, kernelModule),
      logger: recorder.logger as never,
    });
    const instance: KernelInstance = {
      id: `k_${randomUUID()}`,
      key,
      kernel,
      clients: new Set(),
      state: 'running',
      lastUsedAt: new Date(this.now()),
      pruned: Object.freeze([...recorder.pruned]),
    };

    this.instances.set(instance.id, instance);

    return instance;
  }

  /**
   * Kernel-owned fields come from the daemon home; the operator's fixed
   * options override them; the client's allowed options come last but can
   * only name allowed fields.
   */
  private kernelOptions(
    stateFolder: string,
    clientOptions: Readonly<Record<string, unknown>>,
    kernelModule: KernelModule,
  ): Record<string, unknown> {
    const options: Record<string, unknown> = {
      [IDENTITY_REGISTRY_PATH_FIELD]: join(stateFolder, 'identity.json'),
      [EXPOSED_API_SCOPE_RECORD_FIELD]: join(stateFolder, 'exposed-api.json'),
      ...this.operator.fixedOptions,
      ...clientOptions,
    };
    const registryPath = options[IDENTITY_REGISTRY_PATH_FIELD];

    if (typeof registryPath === 'string' && !existsSync(registryPath)) {
      mkdirSync(dirname(registryPath), { recursive: true });
      kernelModule.provisionIdentityRegistryStorage(registryPath);
    }

    return options;
  }

  /** Attaches a client to an existing instance. */
  attach(instanceId: string, clientId: string): KernelInstance {
    const instance = this.instances.get(instanceId);

    if (instance === undefined || instance.state !== 'running') {
      throw new KernelInstanceNotFoundError(instanceId);
    }

    instance.clients.add(clientId);
    instance.lastUsedAt = new Date(this.now());

    return instance;
  }

  /** An instance the client is attached to. */
  forClient(instanceId: string, clientId: string): KernelInstance {
    const instance = this.instances.get(instanceId);

    if (instance === undefined || instance.state !== 'running' || !instance.clients.has(clientId)) {
      throw new KernelInstanceNotFoundError(instanceId);
    }

    instance.lastUsedAt = new Date(this.now());

    return instance;
  }

  /** Instances the client is attached to. */
  listFor(clientId: string): readonly KernelInstance[] {
    return [...this.instances.values()].filter((entry) => entry.clients.has(clientId));
  }

  /** Detaches a closing client from every instance. */
  detachClient(clientId: string): void {
    for (const instance of this.instances.values()) {
      if (instance.clients.delete(clientId)) {
        instance.lastUsedAt = new Date(this.now());
      }
    }
  }

  /** Shuts one instance down. */
  async dispose(instanceId: string): Promise<boolean> {
    const instance = this.instances.get(instanceId);

    if (instance === undefined) {
      return false;
    }

    this.instances.delete(instanceId);
    instance.state = 'shutting-down';

    try {
      await instance.kernel.shutdown();
    } catch (error: unknown) {
      this.logger?.warn('Kernel instance shutdown failed', {
        instanceId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      instance.state = 'disposed';
      instance.clients.clear();
    }

    return true;
  }

  /** Disposes client-less instances idle past the timeout. */
  async sweepIdle(): Promise<void> {
    if (this.idleTimeoutMs <= 0) {
      return;
    }

    const cutoff = this.now() - this.idleTimeoutMs;

    for (const instance of [...this.instances.values()]) {
      if (instance.clients.size === 0 && instance.lastUsedAt.getTime() <= cutoff) {
        await this.dispose(instance.id);
      }
    }
  }

  /** Every running instance (daemon-internal: shutdown, activity). */
  get size(): number {
    return this.instances.size;
  }

  /** Shuts every instance down. */
  async disposeAll(): Promise<void> {
    this.disposed = true;

    if (this.sweepTimer !== undefined) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }

    await Promise.all([...this.instances.keys()].map((id) => this.dispose(id)));
  }
}
