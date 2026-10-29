import type { KernelLogger, ServiceContext, ServiceTier } from '../../../src/contracts/lifecycle.js';
import type { ServiceDescriptor } from '../../../src/contracts/serviceDescriptor.js';
import type {
  ISettingsReader,
  SettingsSnapshot,
} from '../../SettingsService/contracts/ISettingsService.js';
import { SettingsToken } from '../../SettingsService/descriptor/tokens.js';
import type {
  IValidationService,
  ValidationWorkspacePort,
} from '../../ValidationService/contracts/IValidationService.js';
import { ValidationToken } from '../../ValidationService/descriptor/tokens.js';
import { WorkspaceToken } from '../../WorkspaceService/descriptor/tokens.js';
import type { ITerminalService } from '../contracts/ITerminalService.js';
import {
  DEFAULT_TERMINAL_POLICY,
  type TerminalPolicy,
} from '../contracts/policies.js';
import { ProcessManager } from '../engine/ProcessManager.js';
import { ShellAdapter } from '../engine/ShellAdapter.js';
import { TerminalService, type TerminalValidatorPort } from '../orchestrator/TerminalService.js';
import { TerminalToken } from './tokens.js';

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
  return {
    token: TerminalToken,
    tier: TERMINAL_SERVICE_TIER,
    dependencies: [SettingsToken, WorkspaceToken, ValidationToken],
    accessPolicy: { deniedCallers: [] },
    factory: (context: ServiceContext, broker): TerminalService => {
      const kernelCaller: ServiceContext = {
        callerId: 'kernel',
        tier: 'kernel',
        workspaceRoot: context.workspaceRoot,
      };
      // The broker only serves requests while the kernel is RUNNING and
      // factories run during BOOTING, so dependencies are resolved lazily and
      // touched on first use. The workspace root comes from the boot context,
      // which is already canonical by the time any factory runs.
      const injectedValidator = options?.validator;
      let validator: TerminalValidatorPort | undefined = injectedValidator;
      let workspace: ValidationWorkspacePort | undefined;
      let settings: ISettingsReader | undefined;
      let pinnedPolicy: TerminalPolicy | undefined;

      const resolveValidator = (): TerminalValidatorPort | undefined => {
        if (validator === undefined) {
          validator = broker.requestAccess<IValidationService>(kernelCaller, ValidationToken);
        }

        return validator;
      };
      const resolveWorkspace = (): ValidationWorkspacePort => {
        workspace ??= broker.requestAccess<ValidationWorkspacePort>(kernelCaller, WorkspaceToken);

        return workspace;
      };
      // The frozen policy is derived once from the boot snapshot so an
      // in-flight session cannot observe a settings change between admission
      // and spawn. An explicit override, or an unresolvable snapshot, falls
      // back to the standalone defaults.
      const resolvePolicy = (): TerminalPolicy => {
        if (pinnedPolicy !== undefined) {
          return pinnedPolicy;
        }

        if (options?.policy !== undefined) {
          pinnedPolicy = options.policy;

          return pinnedPolicy;
        }

        try {
          settings ??= broker.requestAccess<ISettingsReader>(kernelCaller, SettingsToken);
          pinnedPolicy = toTerminalPolicy(settings.getSnapshot());
        } catch (error) {
          context.logger?.warn(
            `TerminalService: settings snapshot could not be read (${error instanceof Error ? error.message : String(error)}); using default terminal policy.`,
          );
          pinnedPolicy = DEFAULT_TERMINAL_POLICY;
        }

        return pinnedPolicy;
      };

      const service = new TerminalService({
        policy: resolvePolicy(),
        ...(options?.validator === undefined ? {} : { validator: options.validator }),
        workspaceRoot: options?.workspaceRoot ?? context.workspaceRoot,
        processes: new ProcessManager(new ShellAdapter()),
        ...(context.logger === undefined ? {} : { logger: context.logger }),
      });

      registerTerminalBootPinner(service, (): void => {
        // An unresolvable authority leaves the service unbound, so every
        // execution fails closed with `TERMINAL_UNAVAILABLE` instead of
        // hanging on a boot pin or admitting an unvalidated command.
        const boundValidator = resolveBoundValidator(resolveValidator, context.logger);

        if (boundValidator !== undefined) {
          // Touching the workspace authority proves the containment
          // dependency is resolved; the validation gate already runs every
          // command through it.
          void resolveWorkspace().primaryRoot;
        } else {
          context.logger?.warn(
            'TerminalService: validation authority could not be resolved; terminal execution will fail closed.',
          );
        }

        service.pinBootPolicy({
          policy: resolvePolicy(),
          ...(boundValidator === undefined ? {} : { validator: boundValidator }),
          ...(options?.workspaceRoot === undefined ? {} : { workspaceRoot: options.workspaceRoot }),
        });
      });

      return service;
    },
  };
}

/**
 * Resolves the boot validation authority, returning `undefined` when it cannot
 * be bound.
 *
 * The descriptor records the service as unvalidated rather than propagating
 * the failure: a terminal that cannot prove a command is safe must refuse it,
 * not stall the boot sequence.
 *
 * @param resolve - Thunk that requests the authority from the broker.
 * @param logger - Diagnostic sink.
 */
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
