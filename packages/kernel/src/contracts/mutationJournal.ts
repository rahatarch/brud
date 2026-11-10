/**
 * Domain-agnostic mutation journal port.
 *
 * The kernel core needs to construct and share a journal between the
 * filesystem and history services, but it must not import either service.
 * This port is the only shape the core knows: publish a mutation, observe
 * whether anyone is listening, and subscribe a listener.
 *
 * Concrete journals live in their owning service and are structurally
 * compatible with this port.
 */
export interface MutationJournalPort {
  /** `true` when at least one listener is subscribed. */
  readonly enabled: boolean;

  /** Publishes a mutation descriptor. Never throws into the mutation path. */
  publish(event: object): void;

  /**
   * Subscribes a listener.
   *
   * @param listener - Mutation observer.
   * @returns An unsubscribe function.
   */
  subscribe(listener: (event: object) => unknown): () => void;
}