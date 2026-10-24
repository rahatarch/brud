import type { PluginPermission } from './permissions.js';

/** Stable, machine-readable codes for plugin domain failures. */
export type PluginErrorCode =
  | 'PLUGIN_NOT_FOUND'
  | 'PLUGIN_DUPLICATE'
  | 'PLUGIN_DEPENDENCY'
  | 'PLUGIN_PERMISSION'
  | 'PLUGIN_LIFECYCLE';

/**
 * Base class for every plugin domain failure.
 *
 * Subclasses carry a stable {@link PluginErrorCode} so hosts can branch on
 * failures without parsing human-readable messages.
 */
export abstract class PluginError extends Error {
  /** Stable, machine-readable error code. */
  public abstract readonly code: PluginErrorCode;

  /**
   * @param message - Human-readable failure description.
   * @param options - Optional native error options, including `cause`.
   */
  protected constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PluginError';
  }
}

/** Raised when a plugin identifier is not registered with the manager. */
export class PluginNotFoundError extends PluginError {
  public readonly code = 'PLUGIN_NOT_FOUND' as const;

  /** Identifier of the missing plugin. */
  public readonly pluginId: string;

  constructor(pluginId: string) {
    super(`Plugin "${pluginId}" is not registered`);
    this.name = 'PluginNotFoundError';
    this.pluginId = pluginId;
  }
}

/** Raised when a plugin identifier is registered more than once. */
export class PluginDuplicateError extends PluginError {
  public readonly code = 'PLUGIN_DUPLICATE' as const;

  /** Identifier registered more than once. */
  public readonly pluginId: string;

  constructor(pluginId: string) {
    super(`Plugin "${pluginId}" is already registered`);
    this.name = 'PluginDuplicateError';
    this.pluginId = pluginId;
  }
}

/** Options describing a dependency failure. */
export interface PluginDependencyErrorOptions {
  /** Plugin whose dependency graph could not be resolved. */
  readonly pluginId: string;

  /** Missing dependency identifier, when the failure is an absent plugin. */
  readonly dependencyId?: string;

  /** Ordered cycle path, when the failure is a circular dependency. */
  readonly cyclePath?: readonly string[];
}

/**
 * Raised when the plugin dependency graph cannot be satisfied, either because
 * a declared dependency is missing or because the graph contains a cycle.
 */
export class PluginDependencyError extends PluginError {
  public readonly code = 'PLUGIN_DEPENDENCY' as const;

  /** Plugin whose dependency graph could not be resolved. */
  public readonly pluginId: string;

  /** Missing dependency identifier, when applicable. */
  public readonly dependencyId: string | undefined;

  /** Ordered cycle path, when applicable. */
  public readonly cyclePath: readonly string[] | undefined;

  constructor(options: PluginDependencyErrorOptions) {
    super(PluginDependencyError.formatMessage(options));
    this.name = 'PluginDependencyError';
    this.pluginId = options.pluginId;
    this.dependencyId = options.dependencyId;
    this.cyclePath = options.cyclePath === undefined ? undefined : [...options.cyclePath];
  }

  private static formatMessage(options: PluginDependencyErrorOptions): string {
    if (options.cyclePath !== undefined) {
      return `Plugin dependency cycle detected: ${options.cyclePath.join(' -> ')}`;
    }

    if (options.dependencyId !== undefined) {
      return `Plugin "${options.pluginId}" depends on unregistered plugin "${options.dependencyId}"`;
    }

    return `Plugin "${options.pluginId}" has an unsatisfiable dependency graph`;
  }
}

/**
 * Raised when a plugin attempts to use a capability it did not declare in its
 * manifest, or when a host performs an operation the plugin is not allowed to
 * perform.
 */
export class PluginPermissionError extends PluginError {
  public readonly code = 'PLUGIN_PERMISSION' as const;

  /** Plugin that attempted the operation. */
  public readonly pluginId: string;

  /** Operation that was attempted. */
  public readonly operation: string;

  /** Declared permissions that would have authorized the operation. */
  public readonly requiredPermissions: readonly PluginPermission[];

  constructor(
    pluginId: string,
    operation: string,
    requiredPermissions: readonly PluginPermission[],
  ) {
    super(
      `Plugin "${pluginId}" cannot perform "${operation}": requires one of ${requiredPermissions
        .map((permission) => `"${permission}"`)
        .join(', ')}`,
    );
    this.name = 'PluginPermissionError';
    this.pluginId = pluginId;
    this.operation = operation;
    this.requiredPermissions = [...requiredPermissions];
  }
}

/**
 * Lifecycle phase a plugin failed in.
 */
export type PluginLifecyclePhase = 'activate' | 'deactivate';

/**
 * Raised when a plugin fails to activate or deactivate.
 *
 * The original failure is preserved as the native `cause`.
 */
export class PluginLifecycleError extends PluginError {
  public readonly code = 'PLUGIN_LIFECYCLE' as const;

  /** Plugin whose lifecycle transition failed. */
  public readonly pluginId: string;

  /** Phase that failed. */
  public readonly phase: PluginLifecyclePhase;

  constructor(pluginId: string, phase: PluginLifecyclePhase, cause?: unknown) {
    super(PluginLifecycleError.formatMessage(pluginId, phase, cause), { cause });
    this.name = 'PluginLifecycleError';
    this.pluginId = pluginId;
    this.phase = phase;
  }

  private static formatMessage(
    pluginId: string,
    phase: PluginLifecyclePhase,
    cause: unknown,
  ): string {
    const reason = cause instanceof Error ? cause.message : String(cause);
    const detail = cause === undefined ? '' : `: ${reason}`;
    return `Plugin "${pluginId}" failed to ${phase}${detail}`;
  }
}
