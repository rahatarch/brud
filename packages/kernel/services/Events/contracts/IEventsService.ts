export interface IEventsService {
  emit(name: string, payload: unknown): void;
  pull(subscriptionId: string): readonly unknown[];
  close(subscriptionId: string): void;
  list(): readonly string[];
  /**
   * Creates a subscription to a declared event for the current caller.
   *
   * The subscriber's identity is read from the kernel call context. Returns
   * the subscription identity the events hardcore assigns, or the uniform
   * `null` when the event is not in the catalogue (E-08).
   */
  subscribe(eventName: string): string | null;
}