import type { SessionManifest } from '../../contracts/IUniversalHistoryService/types.js';

/** Inclusive creation-time window used to filter ledger queries. */
export interface LedgerTimeRange {
  readonly from?: string;
  readonly to?: string;
}

/** Query filters supported by {@link LedgerIndex.list}. */
export interface LedgerFilter {
  /** When `true`, soft-deleted manifests are included. Defaults to `false`. */
  readonly includeDeleted?: boolean;
  /** Maximum number of manifests to return. */
  readonly limit?: number;
  /** Inclusive window over `SessionManifest.createdAt`. */
  readonly timeRange?: LedgerTimeRange;
}

function timestampOf(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseBound(value: string, bound: 'from' | 'to'): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new RangeError(`Invalid ledger timeRange ${bound} timestamp: "${value}"`);
  }
  return parsed;
}

function compareManifests(left: SessionManifest, right: SessionManifest): number {
  const leftCreatedAt = timestampOf(left.createdAt);
  const rightCreatedAt = timestampOf(right.createdAt);

  if (leftCreatedAt !== rightCreatedAt) {
    return leftCreatedAt - rightCreatedAt;
  }

  if (left.sessionId === right.sessionId) {
    return 0;
  }

  return left.sessionId < right.sessionId ? -1 : 1;
}

/**
 * Fast in-memory index over session manifests.
 *
 * Manifests are kept in ascending chronological order while `get` resolves
 * identifiers in O(1). {@link list} walks newest-first and stops as soon as
 * the requested limit is satisfied.
 */
export class LedgerIndex {
  private readonly byId = new Map<string, SessionManifest>();

  private ordered: SessionManifest[] = [];

  /** Number of indexed manifests, including soft-deleted ones. */
  get size(): number {
    return this.byId.size;
  }

  /**
   * Inserts or replaces a manifest.
   *
   * Replacing an existing manifest keeps the index free of duplicates and
   * repositions it if its `createdAt` changed.
   */
  upsert(manifest: SessionManifest): void {
    const existing = this.byId.get(manifest.sessionId);

    if (existing !== undefined) {
      const position = this.ordered.indexOf(existing);
      if (position >= 0) {
        this.ordered.splice(position, 1);
      }
    }

    this.byId.set(manifest.sessionId, manifest);
    this.insertOrdered(manifest);
  }

  /** Resolves a manifest by identifier in O(1). */
  get(id: string): SessionManifest | undefined {
    return this.byId.get(id);
  }

  /**
   * Returns manifests ordered newest-first.
   *
   * @param filter - Optional soft-delete, limit, and time-range constraints.
   */
  list(filter: LedgerFilter = {}): readonly SessionManifest[] {
    const includeDeleted = filter.includeDeleted ?? false;
    const requestedLimit = filter.limit ?? Number.POSITIVE_INFINITY;
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(0, Math.floor(requestedLimit))
      : Number.POSITIVE_INFINITY;

    if (limit <= 0) {
      return [];
    }

    const from = filter.timeRange?.from === undefined
      ? undefined
      : parseBound(filter.timeRange.from, 'from');
    const to = filter.timeRange?.to === undefined
      ? undefined
      : parseBound(filter.timeRange.to, 'to');

    const results: SessionManifest[] = [];

    for (let index = this.ordered.length - 1; index >= 0; index -= 1) {
      if (results.length >= limit) {
        break;
      }

      const manifest = this.ordered[index];
      if (manifest === undefined) {
        continue;
      }

      if (!includeDeleted && manifest.isDeleted === true) {
        continue;
      }

      if (from !== undefined || to !== undefined) {
        const createdAt = timestampOf(manifest.createdAt);
        if (from !== undefined && createdAt < from) {
          continue;
        }
        if (to !== undefined && createdAt > to) {
          continue;
        }
      }

      results.push(manifest);
    }

    return results;
  }

  /** Removes every indexed manifest. */
  clear(): void {
    this.byId.clear();
    this.ordered = [];
  }

  private insertOrdered(manifest: SessionManifest): void {
    let low = 0;
    let high = this.ordered.length;

    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = this.ordered[middle];

      if (candidate !== undefined && compareManifests(candidate, manifest) <= 0) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    this.ordered.splice(low, 0, manifest);
  }
}
