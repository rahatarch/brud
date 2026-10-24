import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import type { IBrudFileSystem } from '../../../BrudFileSystem/contracts/IBrudFileSystem/IBrudFileSystem.js';
import {
  SessionNotFoundError,
  type SqliteLedger,
} from '../../storage/SqliteLedger/SqliteLedger.js';
import type { SessionFileRow } from '../../storage/SqliteLedger/types.js';
import { casBlobPath } from '../commit_session/commitSession.js';
import { splitTextLines } from '../compute_delta/computeDelta.js';
import { SessionNotRevertibleError } from './types.js';
import type {
  FileReversalAction,
  PlanReversalInput,
  ReversalConflict,
  ReversalPlan,
  ReversalTargetState,
} from './types.js';

/** Digest recorded when a target had no baseline content. */
export const MISSING_BASELINE_SHA256 = '0'.repeat(64);

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u;
const NO_NEWLINE_MARKER = '\\';

type DiffEntryType = 'equal' | 'delete' | 'insert';

interface DiffEntry {
  readonly type: DiffEntryType;
  line: string;
}

interface DiffHunk {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  readonly entries: readonly DiffEntry[];
}

interface CurrentFileState {
  readonly exists: boolean;
  readonly bytes: Uint8Array | null;
  readonly sha256: string | null;
}

interface TargetPlan {
  readonly action: FileReversalAction;
  readonly conflicts: readonly ReversalConflict[];
}

function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isMissingDigest(digest: string): boolean {
  return digest.length === 0 || digest === MISSING_BASELINE_SHA256;
}

function nullableDigest(digest: string): string | null {
  return isMissingDigest(digest) ? null : digest;
}

function conflict(
  relativePath: string,
  code: ReversalConflict['code'],
  message: string,
  expectedSha256: string,
  actualSha256: string | null,
): ReversalConflict {
  return { relativePath, code, message, expectedSha256, actualSha256 };
}

function parseHunks(diff: string): readonly DiffHunk[] {
  const lines = splitTextLines(diff);
  const hunks: DiffHunk[] = [];
  let index = 0;

  while (index < lines.length) {
    const header = HUNK_HEADER_PATTERN.exec(lines[index]);

    if (header === null) {
      index += 1;
      continue;
    }

    const oldStart = Number.parseInt(header[1], 10);
    const oldCount = header[2] === undefined ? 1 : Number.parseInt(header[2], 10);
    const newStart = Number.parseInt(header[3], 10);
    const newCount = header[4] === undefined ? 1 : Number.parseInt(header[4], 10);
    const entries: DiffEntry[] = [];
    index += 1;

    while (index < lines.length && HUNK_HEADER_PATTERN.exec(lines[index]) === null) {
      const raw = lines[index];

      if (raw.startsWith(NO_NEWLINE_MARKER)) {
        const previous = entries[entries.length - 1];

        if (previous !== undefined && previous.line.endsWith('\n')) {
          previous.line = previous.line.slice(0, -1);
        }

        index += 1;
        continue;
      }

      const marker = raw[0];
      const content = raw.slice(1);

      if (marker === ' ') {
        entries.push({ type: 'equal', line: content });
      } else if (marker === '-') {
        entries.push({ type: 'delete', line: content });
      } else if (marker === '+') {
        entries.push({ type: 'insert', line: content });
      } else {
        break;
      }

      index += 1;
    }

    hunks.push({ oldStart, oldCount, newStart, newCount, entries });
  }

  return hunks;
}

function reversedType(type: DiffEntryType): DiffEntryType {
  if (type === 'delete') {
    return 'insert';
  }

  if (type === 'insert') {
    return 'delete';
  }

  return 'equal';
}

function applyHunks(
  baseLines: readonly string[],
  hunks: readonly DiffHunk[],
  direction: 'forward' | 'reverse',
): readonly string[] {
  const forward = direction === 'forward';
  const output: string[] = [];
  let cursor = 0;

  for (const hunk of hunks) {
    const start = forward ? hunk.oldStart : hunk.newStart;
    const startIndex = Math.max(0, start - 1);

    while (cursor < startIndex && cursor < baseLines.length) {
      output.push(baseLines[cursor]);
      cursor += 1;
    }

    for (const entry of hunk.entries) {
      const type = forward ? entry.type : reversedType(entry.type);

      if (type === 'equal') {
        output.push(baseLines[cursor] ?? entry.line);
        cursor += 1;
      } else if (type === 'insert') {
        output.push(entry.line);
      } else {
        cursor += 1;
      }
    }
  }

  while (cursor < baseLines.length) {
    output.push(baseLines[cursor]);
    cursor += 1;
  }

  return output;
}

/**
 * Reconstructs one side of a stored unified diff.
 *
 * The caller supplies the other side (normally the current disk content). A
 * missing or empty base text is treated as an empty document, which is the
 * correct base for created and deleted targets.
 */
function reconstructText(
  diffContent: string | null,
  baseBytes: Uint8Array | null,
  direction: 'forward' | 'reverse',
): string | null {
  if (diffContent === null) {
    return null;
  }

  const baseText = baseBytes === null ? '' : Buffer.from(baseBytes).toString('utf8');
  const hunks = parseHunks(diffContent);

  return applyHunks(splitTextLines(baseText), hunks, direction).join('');
}

async function readCurrent(
  fileSystem: IBrudFileSystem,
  relativePath: string,
): Promise<CurrentFileState> {
  if (!(await fileSystem.exists(relativePath))) {
    return { exists: false, bytes: null, sha256: null };
  }

  const bytes = await fileSystem.readFile(relativePath);

  return { exists: true, bytes: Uint8Array.from(bytes), sha256: sha256Of(bytes) };
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

async function readBlob(
  fileSystem: IBrudFileSystem,
  sha256: string,
): Promise<Uint8Array | null> {
  if (!SHA256_PATTERN.test(sha256)) {
    return null;
  }

  const relativePath = casBlobPath(sha256);

  if (!(await fileSystem.exists(relativePath))) {
    return null;
  }

  return Uint8Array.from(await fileSystem.readFile(relativePath));
}

function expectedState(
  row: SessionFileRow,
  targetState: ReversalTargetState,
): string | null {
  return targetState === 'pre'
    ? nullableDigest(row.post_sha256)
    : nullableDigest(row.pre_sha256);
}

function staleConflict(
  row: SessionFileRow,
  expectedSha256: string | null,
  actualSha256: string | null,
): ReversalConflict {
  return conflict(
    row.relative_path,
    'STALE_BASELINE_CONFLICT',
    `Current content of "${row.relative_path}" does not match the recorded `
      + `${expectedSha256 === null ? 'absent' : expectedSha256} state`,
    expectedSha256 ?? '',
    actualSha256,
  );
}

function blobConflict(
  row: SessionFileRow,
  sha256: string,
  reason: string,
): ReversalConflict {
  return conflict(
    row.relative_path,
    'BLOB_NOT_FOUND',
    `Cannot recover target bytes for "${row.relative_path}" from CAS blob `
      + `${sha256}: ${reason}`,
    sha256,
    null,
  );
}

async function resolveTargetBytes(
  fileSystem: IBrudFileSystem,
  row: SessionFileRow,
  targetState: ReversalTargetState,
  current: CurrentFileState,
): Promise<{ readonly bytes: Uint8Array | null; readonly conflicts: readonly ReversalConflict[] }> {
  const digest = targetState === 'pre' ? row.pre_sha256 : row.post_sha256;

  if (isMissingDigest(digest)) {
    return { bytes: null, conflicts: [] };
  }

  const direct = await readBlob(fileSystem, digest);

  if (direct !== null) {
    return { bytes: direct, conflicts: [] };
  }

  if (row.blob_sha256 !== null) {
    if (row.blob_sha256 === digest) {
      return {
        bytes: null,
        conflicts: [blobConflict(row, row.blob_sha256, 'blob is missing')],
      };
    }

    if (row.diff_content === null) {
      return {
        bytes: null,
        conflicts: [
          blobConflict(
            row,
            digest,
            'recorded CAS blob belongs to a different target state',
          ),
        ],
      };
    }
  }

  const direction = targetState === 'pre' ? 'reverse' : 'forward';
  const text = reconstructText(row.diff_content, current.bytes, direction);

  if (text === null) {
    return {
      bytes: null,
      conflicts: [blobConflict(row, digest, 'no CAS blob and no recoverable diff')],
    };
  }

  return { bytes: Uint8Array.from(Buffer.from(text, 'utf8')), conflicts: [] };
}

async function planTarget(
  fileSystem: IBrudFileSystem,
  row: SessionFileRow,
  targetState: ReversalTargetState,
): Promise<TargetPlan> {
  const current = await readCurrent(fileSystem, row.relative_path);
  const expectedSha256 = expectedState(row, targetState);
  const conflicts: ReversalConflict[] = [];

  if (current.sha256 !== expectedSha256) {
    conflicts.push(staleConflict(row, expectedSha256, current.sha256));
  }

  const targetDigest = targetState === 'pre' ? row.pre_sha256 : row.post_sha256;
  const isDelete = isMissingDigest(targetDigest);
  let targetBytes: Uint8Array | null = null;

  if (!isDelete) {
    const resolved = await resolveTargetBytes(fileSystem, row, targetState, current);
    targetBytes = resolved.bytes;
    conflicts.push(...resolved.conflicts);
  }

  const action: FileReversalAction = {
    relativePath: row.relative_path,
    action: isDelete ? 'delete' : 'restore',
    targetBytes,
    expectedCurrentSha256: expectedSha256 ?? '',
    actualCurrentSha256: current.sha256,
  };

  return { action, conflicts };
}

/**
 * Builds a deterministic reversal plan without touching the filesystem.
 *
 * Every recorded file row is inspected: the current disk digest is compared
 * against the recorded post-state (for `'pre'` target restores) or pre-state
 * (for `'post'` target restores). Mismatches become `STALE_BASELINE_CONFLICT`
 * entries, and unresolvable baseline bytes become `BLOB_NOT_FOUND` entries.
 *
 * The function performs read-only filesystem calls only; it never writes,
 * renames, or deletes anything.
 *
 * @param input - Ledger, filesystem, session id, and optional target state.
 * @returns The plan, including whether it is safe to execute.
 */
export async function planReversal(input: PlanReversalInput): Promise<ReversalPlan> {
  const { ledger, fileSystem, sessionId } = input;
  const targetState = input.options?.targetState ?? 'pre';
  const session = ledger.getSession(sessionId);

  if (session === null) {
    throw new SessionNotFoundError(sessionId);
  }

  if (session.session.status === 'reverted' || session.session.status === 'aborted') {
    throw new SessionNotRevertibleError(sessionId, session.session.status);
  }

  const actions: FileReversalAction[] = [];
  const conflicts: ReversalConflict[] = [];

  for (const row of session.files) {
    const planned = await planTarget(fileSystem, row, targetState);
    actions.push(planned.action);
    conflicts.push(...planned.conflicts);
  }

  return {
    sessionId,
    targetState,
    actions,
    conflicts,
    isExecutable: conflicts.length === 0,
  };
}
