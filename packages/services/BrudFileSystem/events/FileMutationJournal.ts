import type {
  FileMutationErrorSink,
  FileMutationEvent,
  FileMutationListener,
  IFileMutationJournal,
} from './types.js';

export interface FileMutationJournalOptions {
  /** Receives listener failures instead of surfacing them to the mutation caller. */
  readonly onListenerError?: FileMutationErrorSink;
}

/**
 * In-process, pluggable mutation journal.
 *
 * Publication is intentionally decoupled from the mutation call: listeners run
 * in a queued microtask and both synchronous throws and rejected promises are
 * routed to the error sink. A broken history subscriber can therefore not
 * fail, delay, or roll back a filesystem mutation.
 */
export class FileMutationJournal implements IFileMutationJournal {
  private readonly listeners = new Set<FileMutationListener>();

  private readonly onListenerError: FileMutationErrorSink;

  constructor(options?: FileMutationJournalOptions) {
    this.onListenerError = options?.onListenerError ?? (() => undefined);
  }

  get enabled(): boolean {
    return this.listeners.size > 0;
  }

  subscribe(listener: FileMutationListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(event: FileMutationEvent): void {
    if (this.listeners.size === 0) {
      return;
    }

    const snapshot = Array.from(this.listeners);

    queueMicrotask(() => {
      for (const listener of snapshot) {
        try {
          const outcome = listener(event);

          if (outcome instanceof Promise) {
            outcome.catch((error: unknown) => this.report(error, event));
          }
        } catch (error: unknown) {
          this.report(error, event);
        }
      }
    });
  }

  private report(error: unknown, event: FileMutationEvent): void {
    try {
      this.onListenerError(error, event);
    } catch {
      // An error sink must never reopen the mutation failure path.
    }
  }
}

/** Creates a journal with the supplied error sink. */
export function createFileMutationJournal(
  options?: FileMutationJournalOptions,
): FileMutationJournal {
  return new FileMutationJournal(options);
}
