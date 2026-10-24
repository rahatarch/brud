import type {
  BaselineSnapshot,
  TargetDigest,
} from '../../contracts/IUniversalHistoryService/types.js';
import type { FileChangeKind, FileDelta } from '../compute_delta/types.js';
import { InactiveSessionError } from './types.js';
import type {
  AttachExecutionInput,
  RecordedOperation,
  SessionExecutionState,
} from './types.js';

function missingDigest(relativePath: string): TargetDigest {
  return {
    relativePath,
    sha256: '',
    sizeBytes: 0,
    isBinary: false,
    exists: false,
  };
}

function isBaselineSnapshot(
  session: SessionExecutionState | BaselineSnapshot,
): session is BaselineSnapshot {
  return 'capturedAt' in session && 'targets' in session;
}

/**
 * Creates the initial execution state for a freshly captured baseline.
 *
 * @param baseline - Snapshot captured when the session started.
 */
export function createSessionExecutionState(
  baseline: BaselineSnapshot,
): SessionExecutionState {
  return {
    sessionId: baseline.sessionId,
    status: 'active',
    baseline,
    operations: [],
    results: [],
    deltas: {},
    filesAffected: [],
    updatedAt: baseline.capturedAt,
  };
}

function hasNetChange(preDigest: TargetDigest, postDigest: TargetDigest): boolean {
  if (preDigest.exists !== postDigest.exists) {
    return true;
  }

  if (!preDigest.exists) {
    return false;
  }

  return preDigest.sha256 !== postDigest.sha256;
}

function changeKindFor(
  preDigest: TargetDigest,
  postDigest: TargetDigest,
): FileChangeKind {
  if (!preDigest.exists) {
    return 'created';
  }

  return postDigest.exists ? 'modified' : 'deleted';
}

function mergeDiffContent(previous: string | null, next: string | null): string | null {
  if (next === null) {
    return null;
  }

  if (previous === null || previous.length === 0) {
    return next;
  }

  return previous.endsWith('\n') ? `${previous}${next}` : `${previous}\n${next}`;
}

function withoutPath(paths: readonly string[], target: string): readonly string[] {
  return paths.filter((path) => path !== target);
}

function withPath(paths: readonly string[], target: string): readonly string[] {
  return paths.includes(target) ? paths : [...paths, target];
}

/**
 * Applies a batch of operations, results, and deltas to a session.
 *
 * Baseline immutability is enforced for every target: paths captured in the
 * initial baseline keep their original `preDigest`, while files born during
 * the session always keep an `exists: false` pre-state. Forward deltas are
 * merged per path, so later turns update the post-digest without rewriting
 * the session baseline.
 */
export function attachExecution(input: AttachExecutionInput): SessionExecutionState {
  const attachedAt = input.attachedAt ?? new Date().toISOString();
  const state = isBaselineSnapshot(input.session)
    ? createSessionExecutionState(input.session)
    : input.session;

  if (state.status !== 'active') {
    throw new InactiveSessionError(state.sessionId, state.status);
  }

  const deltas = new Map<string, FileDelta>(Object.entries(state.deltas));
  let filesAffected = state.filesAffected;

  for (const delta of input.deltas) {
    if (!delta.isChanged) {
      continue;
    }

    const relativePath = delta.relativePath;
    const baselineTarget = state.baseline.targets[relativePath];
    const preDigest = baselineTarget === undefined
      ? missingDigest(relativePath)
      : baselineTarget.digest;
    const postDigest = delta.postDigest;

    if (!hasNetChange(preDigest, postDigest)) {
      deltas.delete(relativePath);
      filesAffected = withoutPath(filesAffected, relativePath);
      continue;
    }

    const previous = deltas.get(relativePath);

    deltas.set(relativePath, {
      relativePath,
      changeKind: changeKindFor(preDigest, postDigest),
      isChanged: true,
      isBinary: delta.isBinary,
      preDigest,
      postDigest,
      diffContent: mergeDiffContent(previous?.diffContent ?? null, delta.diffContent),
      blobPayload: delta.blobPayload,
    });
    filesAffected = withPath(filesAffected, relativePath);
  }

  const operations: readonly RecordedOperation[] = input.operations.map((operation) => ({
    id: operation.id,
    kind: operation.kind,
    relativePath: operation.relativePath,
    recordedAt: operation.recordedAt ?? attachedAt,
  }));

  return {
    sessionId: state.sessionId,
    status: state.status,
    baseline: state.baseline,
    operations: [...state.operations, ...operations],
    results: [...state.results, ...(input.results ?? [])],
    deltas: Object.fromEntries(deltas),
    filesAffected,
    updatedAt: attachedAt,
  };
}
