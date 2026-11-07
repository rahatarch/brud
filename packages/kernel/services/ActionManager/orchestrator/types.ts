/**
 * Injected collaborators of {@link ActionManagerService}.
 *
 * Every dependency is optional so the service can be constructed standalone
 * (tests, alternate compositions) without a logger. Payload validation uses
 * the same zero-dependency JSON Schema compiler as `brud.core.tools`, so no
 * validation-service handle is required at runtime.
 */
export interface ActionManagerDependencies {
  /** Diagnostic sink for registry and dispatch warnings. */
  readonly logger?: ActionManagerLogger;
}

/** Minimal diagnostic surface the ActionManager consumes. */
export interface ActionManagerLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}