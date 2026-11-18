/** Stable, machine-readable codes for events-catalogue failures. */
export type EventErrorCode =
  | 'EVENTS_NAME_COLLISION'
  | 'EVENTS_DUPLICATE_DECLARATION';

/** Base class for every events-catalogue domain failure. */
export abstract class EventError extends Error {
  /** Stable, machine-readable error code. */
  public abstract readonly code: EventErrorCode;

  protected constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EventError';
  }
}

/**
 * Raised when a second identity declares an event name another identity owns.
 *
 * A name is owned by the identity that first declared it, across every major
 * version: a version upgrade keeps ownership.
 */
export class EventNameCollisionError extends EventError {
  public readonly code = 'EVENTS_NAME_COLLISION' as const;

  /** Contested event name. */
  public readonly eventName: string;

  /** Identity token that owns the name. */
  public readonly owner: string;

  constructor(eventName: string, owner: string) {
    super(`Event "${eventName}" is already owned by another identity`);
    this.name = 'EventNameCollisionError';
    this.eventName = eventName;
    this.owner = owner;
  }
}

/** Raised when the same (name, major) event is declared twice. */
export class EventDuplicateDeclarationError extends EventError {
  public readonly code = 'EVENTS_DUPLICATE_DECLARATION' as const;

  /** Duplicated event name. */
  public readonly eventName: string;

  /** Duplicated major version. */
  public readonly major: number;

  constructor(eventName: string, major: number) {
    super(`Event "${eventName}" major ${String(major)} is already declared`);
    this.name = 'EventDuplicateDeclarationError';
    this.eventName = eventName;
    this.major = major;
  }
}