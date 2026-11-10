/**
 * Raised when history is composed without the shared storage primitives it
 * needs. Both are service-owned options placed in the generic boot bag by the
 * filesystem service or the host.
 */
export class MissingHistoryStorageDriverError extends Error {
  public readonly code = 'HISTORY_STORAGE_DRIVER_MISSING' as const;

  constructor() {
    super(
      'brud.core.history requires a storage driver in the kernel options bag (options.storageDriver); supply one or compose the filesystem service',
    );
    this.name = 'MissingHistoryStorageDriverError';
  }
}

/** Raised when history is composed without a shared mutation journal. */
export class MissingHistoryMutationJournalError extends Error {
  public readonly code = 'HISTORY_MUTATION_JOURNAL_MISSING' as const;

  constructor() {
    super(
      'brud.core.history requires a mutation journal in the kernel options bag (options.mutationJournal); supply one or compose the filesystem service',
    );
    this.name = 'MissingHistoryMutationJournalError';
  }
}