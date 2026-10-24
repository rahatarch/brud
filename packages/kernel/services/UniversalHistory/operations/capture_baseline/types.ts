import type { IBrudFileSystem } from '../../../BrudFileSystem/contracts/IBrudFileSystem/IBrudFileSystem.js';
import type { BaselineSnapshot } from '../../contracts/IUniversalHistoryService/types.js';

/** Input contract for {@link captureBaseline}. */
export interface CaptureBaselineInput {
  /** Workspace-scoped filesystem used to read every target. */
  readonly fileSystem: IBrudFileSystem;
  /** Session the snapshot belongs to. */
  readonly sessionId: string;
  /** Workspace-relative target paths to capture. */
  readonly relativePaths: readonly string[];
  /** Override for the snapshot timestamp; defaults to the current time. */
  readonly capturedAt?: string;
  /**
   * Number of leading bytes inspected for null-byte binary detection.
   * Defaults to {@link DEFAULT_BINARY_PROBE_LENGTH}.
   */
  readonly binaryProbeLength?: number;
}

/** Output contract for {@link captureBaseline}. */
export type CaptureBaselineResult = BaselineSnapshot;

/** Reasons a target path is rejected before any disk access. */
export type InvalidBaselinePathReason =
  | 'EMPTY_PATH'
  | 'NULL_BYTE'
  | 'ABSOLUTE_PATH'
  | 'PARENT_TRAVERSAL';

/** Thrown when a requested baseline target is not a workspace-relative path. */
export class InvalidBaselinePathError extends Error {
  readonly path: string;

  readonly reason: InvalidBaselinePathReason;

  constructor(path: string, reason: InvalidBaselinePathReason) {
    super(`Invalid baseline path "${path}" (${reason})`);
    this.name = 'InvalidBaselinePathError';
    this.path = path;
    this.reason = reason;
  }
}
