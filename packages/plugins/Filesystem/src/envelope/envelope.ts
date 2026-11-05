/**
 * Operation envelopes for the Filesystem tools.
 *
 * The envelope is deliberately plugin-native: `data` carries structured file,
 * skip, error, session, and pre-state records while the kernel
 * `OperationResult` carries the dispatch status and human-readable summary.
 */

export type MutationFileStatus =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'renamed'
  | 'moved'
  | 'copied'
  | 'appended'
  | 'replaced'
  | 'directory-created'
  | 'directory-deleted'
  | 'directory-moved';

export interface MutationFileEntry {
  path: string;
  status: MutationFileStatus;
  from?: string;
  to?: string;
}

export interface MutationSkipEntry {
  path: string;
  reason: string;
  code?: string;
}

export interface MutationErrorEntry {
  code: string;
  message: string;
  path?: string;
}

export interface PreStateEntry {
  path: string;
  status: 'missing' | 'file' | 'directory';
  content?: string;
  size?: number;
}

export type MutationResultStatus = 'success' | 'partial' | 'failed';

export interface MutationResult {
  kind: string;
  status: MutationResultStatus;
  message: string;
  files: MutationFileEntry[];
  skipped: MutationSkipEntry[];
  errors: MutationErrorEntry[];
  sessionId?: string;
  preState?: PreStateEntry[];
}

export interface EnvelopeOptions {
  readonly sessionId?: string;
  readonly message?: string;
  readonly preState?: readonly PreStateEntry[];
}

/** Builds one skip record. */
export function buildSkipEntry(
  path: string,
  reason: string,
  code?: string,
): MutationSkipEntry {
  return {
    path,
    reason,
    ...(code === undefined ? {} : { code }),
  };
}

function base(
  kind: string,
  status: MutationResultStatus,
  message: string,
  files: readonly MutationFileEntry[],
  skipped: readonly MutationSkipEntry[],
  errors: readonly MutationErrorEntry[],
  options: EnvelopeOptions,
): MutationResult {
  return {
    kind,
    status,
    message,
    files: [...files],
    skipped: [...skipped],
    errors: [...errors],
    ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
    ...(options.preState === undefined ? {} : { preState: [...options.preState] }),
  };
}

/** Builds a success envelope. */
export function buildSuccessEnvelope(
  kind: string,
  files: readonly MutationFileEntry[],
  options: EnvelopeOptions = {},
): MutationResult {
  return base(
    kind,
    'success',
    options.message ?? `${kind} completed.`,
    files,
    [],
    [],
    options,
  );
}

/** Builds a partial envelope: some files were skipped, none failed. */
export function buildPartialEnvelope(
  kind: string,
  files: readonly MutationFileEntry[],
  skipped: readonly MutationSkipEntry[],
  options: EnvelopeOptions = {},
): MutationResult {
  return base(
    kind,
    'partial',
    options.message ?? `${kind} completed with ${skipped.length} skipped file(s).`,
    files,
    skipped,
    [],
    options,
  );
}

/** Builds a failure envelope. */
export function buildFailureEnvelope(
  kind: string,
  errors: readonly MutationErrorEntry[],
  options: EnvelopeOptions = {},
): MutationResult {
  return base(
    kind,
    'failed',
    options.message ?? errors[0]?.message ?? `${kind} failed.`,
    [],
    [],
    errors,
    options,
  );
}