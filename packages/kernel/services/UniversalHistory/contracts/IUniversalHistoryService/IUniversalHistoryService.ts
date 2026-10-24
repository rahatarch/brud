import type { BaselineSnapshot, SessionManifest } from './types.js';

/** Options accepted when opening a new history session. */
export interface BeginSessionOptions {
  readonly prompt: string;
  readonly declaredTargets?: readonly string[];
}

/** Options accepted when listing session manifests. */
export interface ListManifestsOptions {
  readonly includeDeleted?: boolean;
  readonly limit?: number;
}

/**
 * High-integrity transactional history and reversal ledger service.
 *
 * Implementations persist byte-safe baselines, session manifests, and
 * monotonic identifiers through {@link IBrudFileSystem}. Every path handled
 * by this service is workspace-relative.
 */
export interface IUniversalHistoryService {
  beginSession(options: BeginSessionOptions): Promise<{ sessionId: string }>;

  captureBaseline(sessionId: string, relativePaths: readonly string[]): Promise<BaselineSnapshot>;

  getManifest(sessionId: string): Promise<SessionManifest | null>;

  listManifests(options?: ListManifestsOptions): Promise<readonly SessionManifest[]>;
}
