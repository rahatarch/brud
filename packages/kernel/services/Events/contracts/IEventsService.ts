import type { ExposedApiCaller } from '../../ExposedApiRegistry/contracts/types.js';

/** Backpressure a subscriber declares at subscribe time; enforced at emit. */
export type EventsBackpressurePolicy = 'drop-oldest' | 'refuse-emit' | 'drop-newest';

/** Options a subscriber passes to `subscribe`. */
export interface EventsSubscribeOptions {
  /** Backpressure policy; defaults to `drop-oldest`. */
  readonly policy?: EventsBackpressurePolicy;
  /** Last sequence already seen; the subscription starts after it. */
  readonly lastSequence?: number;
  /**
   * The end subscriber's caller view, forwarded by the event's owner when its
   * subscription API creates the subscription on a subscriber's behalf.
   * Honoured only when the resolver of `events.subscribe` is the event's owner.
   */
  readonly subscriber?: ExposedApiCaller;
}

/** Options a subscriber passes to `pull`. */
export interface EventsPullOptions {
  /** Reconnect: return the retained emits after this sequence. */
  readonly lastSequence?: number;
  /** Batch bound, capped by the hardcore's batch size. */
  readonly maxBatch?: number;
}

/** One plain delivery. */
export interface EventDeliveryRecord {
  readonly eventName: string;
  readonly eventVersion: number;
  readonly emitterIdentity: string | null;
  readonly emitOrigin: string;
  readonly sequence: number;
  readonly payload: unknown;
}

/** A reason-carrying refusal, distinguishable from an empty batch. */
export interface EventsRefusal {
  readonly refused: true;
  readonly reason: 'unknown-subscription' | 'not-subscriber' | 'closed' | 'not-live' | 'policy-refused';
  readonly detail?: string;
}

/**
 * The emit outcome. An accepted emit carries its sequence and the
 * subscriptions whose `refuse-emit` queue refused their copy; a refused emit
 * consumes no sequence.
 */
export type EventsEmitResult =
  | { readonly ok: true; readonly sequence: number; readonly refusedSubscriptions: readonly string[] }
  | { readonly ok: false; readonly reason: 'malformed' | 'refused'; readonly detail: string };

export interface IEventsService {
  emit(name: string, payload: unknown): EventsEmitResult;
  pull(subscriptionId: string, options?: EventsPullOptions): readonly EventDeliveryRecord[] | EventsRefusal;
  close(subscriptionId: string): EventsRefusal | undefined;
  list(): readonly string[];
  /**
   * Creates a subscription to the highest declared major of `eventName`.
   * Returns the subscription identity the events hardcore assigns, or the
   * uniform `null` (E-08).
   */
  subscribe(eventName: string, options?: EventsSubscribeOptions): string | null;
}
