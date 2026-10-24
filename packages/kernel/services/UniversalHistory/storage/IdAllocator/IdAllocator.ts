import type { IBrudFileSystem } from '../../../BrudFileSystem/contracts/IBrudFileSystem/IBrudFileSystem.js';
import type { SessionId } from '../../contracts/IUniversalHistoryService/types.js';

/** Default counter file, relative to the history-scoped filesystem root. */
export const DEFAULT_SEQUENCE_FILE = 'seq.json';

/** Highest sequence number that fits the `BR-YYYYMMDD-NNN(N)` identifier. */
export const MAX_SEQUENCE = 9999;

interface SequenceState {
  readonly date: string;
  readonly sequence: number;
}

/** Configuration for {@link IdAllocator}. */
export interface IdAllocatorOptions {
  /** Counter file path relative to the supplied filesystem root. */
  readonly sequenceFile?: string;
  /** Clock injection point; defaults to the system clock. */
  readonly now?: () => Date;
}

/** Thrown when a single UTC day exhausts its sequence space. */
export class IdSequenceOverflowError extends Error {
  readonly date: string;

  readonly maxSequence: number;

  constructor(date: string, maxSequence: number = MAX_SEQUENCE) {
    super(`Session id sequence exhausted for ${date} (maximum ${maxSequence})`);
    this.name = 'IdSequenceOverflowError';
    this.date = date;
    this.maxSequence = maxSequence;
  }
}

function pad(value: number, length: number): string {
  return value.toString().padStart(length, '0');
}

/**
 * Formats a date as a UTC `YYYYMMDD` segment.
 *
 * @param date - Date to format.
 * @returns The UTC calendar day.
 */
export function formatUtcDate(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError('Cannot format an invalid date');
  }

  return `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1, 2)}${pad(date.getUTCDate(), 2)}`;
}

/**
 * Formats a session identifier from a UTC day and a sequence number.
 *
 * @param date - UTC `YYYYMMDD` day segment.
 * @param sequence - Monotonic per-day sequence in `1..9999`.
 * @returns The formatted identifier, e.g. `BR-20260131-001`.
 */
export function formatSessionId(date: string, sequence: number): SessionId {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > MAX_SEQUENCE) {
    throw new RangeError(`Sequence must be an integer in 1..${MAX_SEQUENCE}: ${sequence}`);
  }

  return `BR-${date}-${pad(sequence, 3)}`;
}

function parseSequenceState(raw: string): SequenceState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  if (!('date' in parsed) || !('sequence' in parsed)) {
    return null;
  }

  const { date, sequence } = parsed;

  if (typeof date !== 'string' || !/^\d{8}$/.test(date)) {
    return null;
  }

  if (typeof sequence !== 'number' || !Number.isInteger(sequence)) {
    return null;
  }

  if (sequence < 1 || sequence > MAX_SEQUENCE) {
    return null;
  }

  return { date, sequence };
}

function serializeSequenceState(state: SequenceState): string {
  return `${JSON.stringify({ date: state.date, sequence: state.sequence }, null, 2)}\n`;
}

/**
 * Allocates monotonic, collision-free session identifiers.
 *
 * The allocator is pinned to a history-scoped {@link IBrudFileSystem} and
 * persists its per-day counter through `writeAtomic`, so concurrent
 * instances sharing the same driver observe a consistent sequence.
 */
export class IdAllocator {
  private readonly fileSystem: IBrudFileSystem;

  private readonly sequenceFile: string;

  private readonly now: () => Date;

  private cachedState: SequenceState | null = null;

  private queue: Promise<void> = Promise.resolve();

  constructor(fileSystem: IBrudFileSystem, options?: IdAllocatorOptions) {
    this.fileSystem = fileSystem;
    this.sequenceFile = options?.sequenceFile ?? DEFAULT_SEQUENCE_FILE;
    this.now = options?.now ?? ((): Date => new Date());
  }

  /**
   * Allocates the next identifier for the current UTC day.
   *
   * Calls are serialized so concurrent invitations always observe strictly
   * increasing sequence numbers.
   */
  async next(): Promise<SessionId> {
    const allocation = this.queue.then(
      () => this.allocate(),
      () => this.allocate(),
    );
    this.queue = allocation.then(
      () => undefined,
      () => undefined,
    );
    return allocation;
  }

  private async allocate(): Promise<SessionId> {
    const date = formatUtcDate(this.now());
    const state = this.cachedState ?? await this.readState();

    const sequence = state !== null && state.date === date ? state.sequence + 1 : 1;

    if (sequence > MAX_SEQUENCE) {
      throw new IdSequenceOverflowError(date);
    }

    const nextState: SequenceState = { date, sequence };
    await this.fileSystem.writeAtomic(this.sequenceFile, serializeSequenceState(nextState));
    this.cachedState = nextState;

    return formatSessionId(date, sequence);
  }

  private async readState(): Promise<SequenceState | null> {
    if (!(await this.fileSystem.exists(this.sequenceFile))) {
      return null;
    }

    const raw = await this.fileSystem.readText(this.sequenceFile);
    return parseSequenceState(raw);
  }
}
