import type { IBrudFileSystem } from '../../../BrudFileSystem/contracts/IBrudFileSystem/IBrudFileSystem.js';
import type {
  BaselineTarget,
  TargetDigest,
} from '../../contracts/IUniversalHistoryService/types.js';

/** Classification of a computed forward delta. */
export type FileChangeKind = 'created' | 'modified' | 'deleted' | 'unchanged';

/** Input contract for {@link computeDelta}. */
export interface ComputeDeltaInput {
  /** Workspace-scoped filesystem holding the current target state. */
  readonly fileSystem: IBrudFileSystem;
  /** Workspace-relative path being inspected. */
  readonly relativePath: string;
  /** Digest captured before the session (or before the previous step). */
  readonly baseline: TargetDigest;
  /**
   * Captured baseline payload used as the "before" side of text diffs.
   * When omitted, an existing target is diffed against empty content.
   */
  readonly baselinePayload?: BaselineTarget;
  /** Files at or above this byte size are stored as CAS blobs. */
  readonly binarySizeThreshold?: number;
  /** Number of leading bytes inspected for null-byte binary detection. */
  readonly binaryProbeLength?: number;
}

/** Forward delta between a baseline digest and the current target state. */
export interface FileDelta {
  readonly relativePath: string;
  readonly changeKind: FileChangeKind;
  /** `false` only when the bytes and existence match the baseline exactly. */
  readonly isChanged: boolean;
  readonly isBinary: boolean;
  readonly preDigest: TargetDigest;
  readonly postDigest: TargetDigest;
  /** Unified diff for text content, `null` for binary content and deletions. */
  readonly diffContent: string | null;
  /** Raw post-content for binary or oversized targets, else `null`. */
  readonly blobPayload: Uint8Array | null;
}
