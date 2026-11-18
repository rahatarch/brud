/** Numeric bounds of the events hardcore's delivery machinery. */
export interface EventsLimits {
  /** Deliveries each event's retention log keeps (the event's bound). */
  readonly retentionDepth: number;
  /** Unread deliveries one subscription may hold before its backpressure applies. */
  readonly queueDepth: number;
  /** Maximum deliveries one pull returns. */
  readonly batchSize: number;
}

/** Defaults: queue depth is below retention depth so a held backlog stays readable. */
export const DEFAULT_EVENTS_LIMITS: EventsLimits = Object.freeze({
  retentionDepth: 100,
  queueDepth: 50,
  batchSize: 10,
});

let current: EventsLimits = DEFAULT_EVENTS_LIMITS;

/** Returns the bounds in force. */
export function eventsLimits(): EventsLimits {
  return current;
}

/**
 * Overrides the bounds (tests use small bounds to exercise backpressure).
 *
 * @throws RangeError when a bound is not a positive integer or the queue depth
 *   is not below the retention depth.
 */
export function configureEventsLimits(limits: Partial<EventsLimits>): void {
  const next = { ...current, ...limits };

  for (const [key, value] of Object.entries(next)) {
    if (!Number.isInteger(value) || value < 1) {
      throw new RangeError(`events limit "${key}" must be a positive integer`);
    }
  }

  if (next.queueDepth >= next.retentionDepth) {
    throw new RangeError('events queueDepth must be smaller than retentionDepth');
  }

  current = Object.freeze(next);
}

/** Restores the default bounds. */
export function resetEventsLimits(): void {
  current = DEFAULT_EVENTS_LIMITS;
}
