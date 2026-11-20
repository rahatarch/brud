import type { KernelLogger, ServiceTier } from '@brud/kernel';
import type { ServiceDescriptor } from '@brud/kernel';
import { defineParticipant } from '@brud/sdk/participant';
import type {
  ISettingsReader,
  SettingsSnapshot,
} from '../../SettingsService/contracts/ISettingsService.js';
import type {
  IValidationService,
  ValidationWorkspacePort,
} from '../../ValidationService/contracts/IValidationService.js';
import { requireContextString } from '@brud/kernel';
import type { ITerminalService } from '../contracts/ITerminalService.js';
import {
  DEFAULT_TERMINAL_POLICY,
  type TerminalPolicy,
} from '../contracts/policies.js';
import { ProcessManager } from '../engine/ProcessManager.js';
import { ShellAdapter } from '../engine/ShellAdapter.js';
import { TerminalService, type TerminalValidatorPort } from '../orchestrator/TerminalService.js';
import { TerminalToken } from './tokens.js';
import {
  TERMINAL_EXECUTE_CAPABILITY,
  TERMINAL_EXPOSURE,
  TERMINAL_SETTINGS_READER_EXPOSURE,
  TERMINAL_VALIDATION_EXPOSURE,
  TERMINAL_WORKSPACE_EXPOSURE,
} from '../contracts/exposure.js';

/** Namespace owned by the terminal service in the context contract. */
export const TERMINAL_CONTEXT_SCOPE = 'terminal';

/** Namespaced context field holding the workspace root. */
export const TERMINAL_ROOT_CONTEXT_FIELD = 'terminal.root';

/** Tier assigned to the terminal descriptor. */
export const TERMINAL_SERVICE_TIER: ServiceTier = 'core';

/** Configuration for {@link createTerminalDescriptor}. */
export interface TerminalDescriptorOptions {
  /**
   * Explicit policy override. Intended for standalone compositions and tests;
   * the standard kernel always ingests the frozen boot snapshot instead.
   */
  readonly policy?: TerminalPolicy;

  /** Validation authority override. Defaults to `brud.core.validation`. */
  readonly validator?: TerminalValidatorPort;

  /** Workspace root override. Defaults to the boot context root. */
  readonly workspaceRoot?: string;
}

/**
 * Narrows the boot snapshot to the frozen terminal policy.
 *
 * The terminal service reads only its own ceilings from the snapshot; the
 * command gate stays the validation service's authority. Every snapshot key
 * is optional and may arrive `null` or malformed (a hand-written settings
 * document), so a field falls back to its {@link DEFAULT_TERMINAL_POLICY}
 * value unless the snapshot supplies a usable positive finite number.
 *
 * @param snapshot - Frozen settings snapshot.
 */
export function toTerminalPolicy(snapshot: SettingsSnapshot): TerminalPolicy {
  const source = (snapshot ?? {}) as Partial<Record<TerminalPolicyKey, unknown>>;
  const maxTimeoutMs = positiveOr(source.maxTimeoutMs ?? undefined, DEFAULT_TERMINAL_POLICY.maxTimeoutMs);
  const defaultTimeoutMs = Math.min(
    positiveOr(source.defaultTimeoutMs ?? undefined, DEFAULT_TERMINAL_POLICY.defaultTimeoutMs),
    maxTimeoutMs,
  );

  return Object.freeze({
    ...DEFAULT_TERMINAL_POLICY,
    defaultTimeoutMs,
    maxTimeoutMs,
    killGraceMs: positiveOr(source.killGraceMs ?? undefined, DEFAULT_TERMINAL_POLICY.killGraceMs),
    maxOutputBytes: positiveOr(source.maxOutputBytes ?? undefined, DEFAULT_TERMINAL_POLICY.maxOutputBytes),
    concurrency: positiveOr(source.concurrency ?? undefined, DEFAULT_TERMINAL_POLICY.concurrency),
    maxBatchCommands: positiveOr(
      source.maxBatchCommands ?? undefined,
      DEFAULT_TERMINAL_POLICY.maxBatchCommands,
    ),
    schemaVersion: 1 as const,
  });
}

/** Snapshot keys the terminal policy reads. */
type TerminalPolicyKey =
  | 'defaultTimeoutMs'
  | 'maxTimeoutMs'
  | 'killGraceMs'
  | 'maxOutputBytes'
  | 'concurrency'
  | 'maxBatchCommands';

/**
 * Returns a usable positive finite number, or the fallback.
 *
 * @param value - Candidate snapshot value.
 * @param fallback - Default applied when the value is absent or unusable.
 */
function positiveOr(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}

/**
 * The handle a terminal caller receives. Sessions are attributed to the
 * kernel-derived caller (its identity, or its class for the host session),
 * never to a value the request supplies.
 */
export function createTerminalHandle(
  caller: { readonly identity: string | null; readonly callerClass: string },
  service: ITerminalService,
): ITerminalService {
  const owner = caller.identity ?? caller.callerClass;

  return {
    run: (request, runOptions) => service.run({ ...request, callerId: owner }, runOptions),
    registerExternal: (session, controls) => service.registerExternal({ ...session, callerId: owner }, controls),
    registerChild: (child, onChunk) => service.registerChild(child, onChunk),
    kill: (sessionId) => service.kill(sessionId),
    killAll: () => service.killAll(),
    activeSessions: () => service.activeSessions(),
    chunkCallback: (sessionId) => service.chunkCallback(sessionId),
    hasSession: (sessionId) => service.hasSession(sessionId),
    unregister: (sessionId) => service.unregister(sessionId),
    getPolicy: () => service.getPolicy(),
  };
}

/**
 * Builds the terminal service descriptor.
 *
 * Boot position is after validation: the service re-validates every command,
 * including conditional branches, through `brud.core.validation` before it
 * spawns anything.
 *
 * @param options - Optional policy, validator and workspace overrides.
 * @returns A core-tier descriptor for `brud.core.terminal`.
 */
export function createTerminalDescriptor(
  options?: TerminalDescriptorOptions,
): ServiceDescriptor<ITerminalService, TerminalService> {
  let created: TerminalService | undefined;

  const base = defineParticipant<TerminalService>({
    id: TerminalToken.id,
    description: TerminalToken.description,
    tier: TERMINAL_SERVICE_TIER,
    requests: ['validation:read', 'workspace:read'],
    exposes: {
      [TERMINAL_EXPOSURE]: {
        version: 1,
        scope: 'runtime',
        policy: { policyVersion: 2, capabilities: [TERMINAL_EXECUTE_CAPABILITY] },
        handle: (caller, ctx) => createTerminalHandle(caller, ctx.instance),
      },
    },
    create: (ctx) => {
      const logger = ctx.logger;
      let validator: TerminalValidatorPort | undefined = options?.validator;
      let workspace: ValidationWorkspacePort | undefined;

      const resolveValidator = (): TerminalValidatorPort | undefined => {
        validator ??= ctx.resolve<IValidationService>(TERMINAL_VALIDATION_EXPOSURE) ?? undefined;

        return validator;
      };
      const resolveWorkspace = (): ValidationWorkspacePort | undefined => {
        workspace ??= ctx.resolve<ValidationWorkspacePort>(TERMINAL_WORKSPACE_EXPOSURE) ?? undefined;

        return workspace;
      };
      const readPolicy = (): TerminalPolicy => {
        if (options?.policy !== undefined) {
          return options.policy;
        }

        const settings = ctx.resolve<ISettingsReader>(TERMINAL_SETTINGS_READER_EXPOSURE);

        if (settings === null) {
          throw new Error(`${TERMINAL_SETTINGS_READER_EXPOSURE} is not resolvable`);
        }

        return toTerminalPolicy(settings.getSnapshot());
      };

      const service = new TerminalService({
        policy: options?.policy ?? DEFAULT_TERMINAL_POLICY,
        ...(options?.validator === undefined ? {} : { validator: options.validator }),
        workspaceRoot: options?.workspaceRoot
          ?? requireContextString(ctx.bootOptions, TERMINAL_ROOT_CONTEXT_FIELD, TerminalToken.id),
        processes: new ProcessManager(new ShellAdapter()),
        ...(logger === undefined ? {} : { logger }),
      });

      let pinned = false;
      registerTerminalBootPinner(service, (): void => {
        // resolve is live only once RUNNING; the pre-RUNNING module hook is a no-op.
        if (!ctx.running || pinned) {
          return;
        }

        pinned = true;
        let policy: TerminalPolicy;

        try {
          policy = readPolicy();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger?.warn(
            `TerminalService: settings snapshot could not be read (${message}); terminal execution is denied.`,
          );
          service.pinBootPolicy({ policyError: message });

          return;
        }

        const boundValidator = resolveBoundValidator(resolveValidator, logger);

        if (boundValidator !== undefined) {
          void resolveWorkspace()?.primaryRoot;
        } else {
          logger?.warn(
            'TerminalService: validation authority could not be resolved; terminal execution will fail closed.',
          );
        }

        service.pinBootPolicy({
          policy,
          ...(boundValidator === undefined ? {} : { validator: boundValidator }),
          ...(options?.workspaceRoot === undefined ? {} : { workspaceRoot: options.workspaceRoot }),
        });
      });
      created = service;

      return service;
    },
    onRunning: () => {
      if (created !== undefined) {
        pinTerminalPolicies([created]);
      }
    },
  })();

  return base as unknown as ServiceDescriptor<ITerminalService, TerminalService>;
}

function resolveBoundValidator(
  resolve: () => TerminalValidatorPort | undefined,
  logger: KernelLogger | undefined,
): TerminalValidatorPort | undefined {
  try {
    return resolve();
  } catch (error) {
    logger?.warn(
      `TerminalService: validation authority resolution failed (${error instanceof Error ? error.message : String(error)}).`,
    );

    return undefined;
  }
}

/** Boot pinning hooks, keyed by service instance. */
const BOOT_PINNERS = new WeakMap<object, () => void>();

/**
 * Registers the boot-time pinner for a terminal instance.
 *
 * @param service - Terminal service instance.
 * @param pin - Callback that binds the boot dependencies.
 */
export function registerTerminalBootPinner(service: object, pin: () => void): void {
  BOOT_PINNERS.set(service, pin);
}

/**
 * Runs every registered terminal boot pinner.
 *
 * The standard kernel composition calls this from its shared boot pinner,
 * while the access broker's lifecycle gate is suspended.
 *
 * @param instances - Resolved instances, in boot order.
 */
export function pinTerminalPolicies(instances: readonly object[]): void {
  for (const instance of instances) {
    const pin = BOOT_PINNERS.get(instance);

    if (pin !== undefined) {
      pin();
    }
  }
}
