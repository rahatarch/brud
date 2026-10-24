import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import type {
  BaselineTarget,
  TargetDigest,
} from '../../contracts/IUniversalHistoryService/types.js';
import {
  DEFAULT_BINARY_PROBE_LENGTH,
  detectBinaryContent,
} from '../capture_baseline/captureBaseline.js';
import type {
  ComputeDeltaInput,
  FileChangeKind,
  FileDelta,
} from './types.js';

/** Targets at or above this size are routed to CAS blob storage. */
export const DEFAULT_BINARY_SIZE_THRESHOLD = 64 * 1024;

/** Number of unchanged lines preserved around every diff hunk. */
export const DEFAULT_DIFF_CONTEXT_LINES = 3;

/**
 * Upper bound on the LCS table size. Pathological line counts fall back to a
 * delete-all/insert-all patch instead of exhausting memory.
 */
const MAX_LCS_CELLS = 4_000_000;

const LINE_PATTERN = /[^\n]*\n|[^\n]+$/gu;

/** Direction of a unified diff header. */
export type UnifiedDiffKind = 'created' | 'modified' | 'deleted';

type DiffLineType = 'equal' | 'delete' | 'insert';

interface DiffLine {
  readonly type: DiffLineType;
  readonly line: string;
}

interface DiffHunk {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  readonly lines: readonly DiffLine[];
}

function missingDigest(relativePath: string): TargetDigest {
  return {
    relativePath,
    sha256: '',
    sizeBytes: 0,
    isBinary: false,
    exists: false,
  };
}

/**
 * Splits text into lines while preserving each line's terminator.
 *
 * @param text - Text to split.
 */
export function splitTextLines(text: string): readonly string[] {
  return text.match(LINE_PATTERN) ?? [];
}

function equalLine(line: string): DiffLine {
  return { type: 'equal', line };
}

function deleteLine(line: string): DiffLine {
  return { type: 'delete', line };
}

function insertLine(line: string): DiffLine {
  return { type: 'insert', line };
}

function diffMiddle(
  before: readonly string[],
  after: readonly string[],
): readonly DiffLine[] {
  const beforeLength = before.length;
  const afterLength = after.length;

  if (beforeLength === 0) {
    return after.map(insertLine);
  }

  if (afterLength === 0) {
    return before.map(deleteLine);
  }

  if ((beforeLength + 1) * (afterLength + 1) > MAX_LCS_CELLS) {
    return [...before.map(deleteLine), ...after.map(insertLine)];
  }

  const width = afterLength + 1;
  const table = new Uint32Array((beforeLength + 1) * width);

  for (let left = beforeLength - 1; left >= 0; left -= 1) {
    for (let right = afterLength - 1; right >= 0; right -= 1) {
      table[left * width + right] = before[left] === after[right]
        ? table[(left + 1) * width + right + 1] + 1
        : Math.max(table[(left + 1) * width + right], table[left * width + right + 1]);
    }
  }

  const result: DiffLine[] = [];
  let left = 0;
  let right = 0;

  while (left < beforeLength && right < afterLength) {
    if (before[left] === after[right]) {
      result.push(equalLine(before[left]));
      left += 1;
      right += 1;
      continue;
    }

    const deleteScore = table[(left + 1) * width + right];
    const insertScore = table[left * width + right + 1];

    if (deleteScore >= insertScore) {
      result.push(deleteLine(before[left]));
      left += 1;
    } else {
      result.push(insertLine(after[right]));
      right += 1;
    }
  }

  while (left < beforeLength) {
    result.push(deleteLine(before[left]));
    left += 1;
  }

  while (right < afterLength) {
    result.push(insertLine(after[right]));
    right += 1;
  }

  return result;
}

function diffLines(
  before: readonly string[],
  after: readonly string[],
): readonly DiffLine[] {
  const sharedLimit = Math.min(before.length, after.length);
  let prefix = 0;

  while (prefix < sharedLimit && before[prefix] === after[prefix]) {
    prefix += 1;
  }

  let suffix = 0;

  while (
    suffix < sharedLimit - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const beforeMiddle = before.slice(prefix, before.length - suffix);
  const afterMiddle = after.slice(prefix, after.length - suffix);
  const prefixLines = before.slice(0, prefix).map(equalLine);
  const suffixLines = before.slice(before.length - suffix).map(equalLine);

  return [...prefixLines, ...diffMiddle(beforeMiddle, afterMiddle), ...suffixLines];
}

function groupHunks(
  script: readonly DiffLine[],
  contextLines: number,
): readonly DiffHunk[] {
  const changeIndices: number[] = [];

  for (let index = 0; index < script.length; index += 1) {
    if (script[index].type !== 'equal') {
      changeIndices.push(index);
    }
  }

  if (changeIndices.length === 0) {
    return [];
  }

  const ranges: Array<{ start: number; end: number }> = [];

  for (const index of changeIndices) {
    const current = ranges[ranges.length - 1];

    if (current !== undefined && index - current.end - 1 <= contextLines * 2) {
      current.end = index;
    } else {
      ranges.push({ start: index, end: index });
    }
  }

  const hunks: DiffHunk[] = [];

  for (const range of ranges) {
    const from = Math.max(0, range.start - contextLines);
    const to = Math.min(script.length, range.end + contextLines + 1);
    const lines = script.slice(from, to);
    let oldBefore = 0;
    let newBefore = 0;

    for (let index = 0; index < from; index += 1) {
      if (script[index].type !== 'insert') {
        oldBefore += 1;
      }

      if (script[index].type !== 'delete') {
        newBefore += 1;
      }
    }

    let oldCount = 0;
    let newCount = 0;

    for (const entry of lines) {
      if (entry.type !== 'insert') {
        oldCount += 1;
      }

      if (entry.type !== 'delete') {
        newCount += 1;
      }
    }

    hunks.push({
      oldStart: oldCount === 0 ? oldBefore : oldBefore + 1,
      oldCount,
      newStart: newCount === 0 ? newBefore : newBefore + 1,
      newCount,
      lines,
    });
  }

  return hunks;
}

function formatRange(start: number, count: number): string {
  return count === 1 ? `${start}` : `${start},${count}`;
}

function appendRenderedLine(parts: string[], prefix: string, line: string): void {
  if (line.endsWith('\n')) {
    parts.push(`${prefix}${line}`);
    return;
  }

  parts.push(`${prefix}${line}\n\\ No newline at end of file\n`);
}

/**
 * Builds a standard unified diff between two text documents.
 *
 * @param relativePath - Workspace-relative path rendered in the headers.
 * @param beforeText - Baseline text.
 * @param afterText - Current text.
 * @param kind - Header direction for creations and deletions.
 * @param contextLines - Unchanged lines preserved around each hunk.
 */
export function createUnifiedDiff(
  relativePath: string,
  beforeText: string,
  afterText: string,
  kind: UnifiedDiffKind = 'modified',
  contextLines: number = DEFAULT_DIFF_CONTEXT_LINES,
): string {
  const oldLabel = kind === 'created' ? '/dev/null' : `a/${relativePath}`;
  const newLabel = kind === 'deleted' ? '/dev/null' : `b/${relativePath}`;
  const headers = [`--- ${oldLabel}\n`, `+++ ${newLabel}\n`];
  const script = diffLines(splitTextLines(beforeText), splitTextLines(afterText));
  const hunks = groupHunks(script, Math.max(0, Math.floor(contextLines)));

  if (hunks.length === 0) {
    return kind === 'modified' ? '' : headers.join('');
  }

  const parts = [...headers];

  for (const hunk of hunks) {
    parts.push(
      `@@ -${formatRange(hunk.oldStart, hunk.oldCount)} `
        + `+${formatRange(hunk.newStart, hunk.newCount)} @@\n`,
    );

    for (const entry of hunk.lines) {
      if (entry.type === 'equal') {
        appendRenderedLine(parts, ' ', entry.line);
      } else if (entry.type === 'delete') {
        appendRenderedLine(parts, '-', entry.line);
      } else {
        appendRenderedLine(parts, '+', entry.line);
      }
    }
  }

  return parts.join('');
}

function baselineText(
  payload: BaselineTarget | undefined,
  preDigest: TargetDigest,
): string {
  if (!preDigest.exists) {
    return '';
  }

  if (payload?.text !== undefined) {
    return payload.text;
  }

  if (payload?.content !== undefined) {
    return Buffer.from(payload.content).toString('utf8');
  }

  return '';
}

function changedKind(preExists: boolean): FileChangeKind {
  return preExists ? 'modified' : 'created';
}

/**
 * Computes the forward delta for one workspace target.
 *
 * Nonexistent targets produce a deletion delta. Targets whose SHA-256 equals
 * the baseline are reported with `isChanged: false` so callers can omit them
 * from forward delta sets. Binary and oversized targets carry a raw
 * `blobPayload` and no textual diff.
 */
export async function computeDelta(input: ComputeDeltaInput): Promise<FileDelta> {
  const { fileSystem, relativePath, baseline } = input;
  const sizeThreshold = input.binarySizeThreshold ?? DEFAULT_BINARY_SIZE_THRESHOLD;
  const probeLength = input.binaryProbeLength ?? DEFAULT_BINARY_PROBE_LENGTH;
  const exists = await fileSystem.exists(relativePath);

  if (!exists) {
    if (!baseline.exists) {
      return {
        relativePath,
        changeKind: 'unchanged',
        isChanged: false,
        isBinary: false,
        preDigest: baseline,
        postDigest: missingDigest(relativePath),
        diffContent: null,
        blobPayload: null,
      };
    }

    const deletionDiff = baseline.isBinary
      ? null
      : createUnifiedDiff(
        relativePath,
        baselineText(input.baselinePayload, baseline),
        '',
        'deleted',
      );

    return {
      relativePath,
      changeKind: 'deleted',
      isChanged: true,
      isBinary: baseline.isBinary,
      preDigest: baseline,
      postDigest: missingDigest(relativePath),
      diffContent: deletionDiff,
      blobPayload: null,
    };
  }

  const bytes = await fileSystem.readFile(relativePath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const isBinary = detectBinaryContent(bytes, probeLength)
    || bytes.byteLength >= sizeThreshold;
  const postDigest: TargetDigest = {
    relativePath,
    sha256,
    sizeBytes: bytes.byteLength,
    isBinary,
    exists: true,
  };

  if (baseline.exists && baseline.sha256 === sha256) {
    return {
      relativePath,
      changeKind: 'unchanged',
      isChanged: false,
      isBinary,
      preDigest: baseline,
      postDigest,
      diffContent: null,
      blobPayload: null,
    };
  }

  const changeKind = changedKind(baseline.exists);

  if (isBinary) {
    return {
      relativePath,
      changeKind,
      isChanged: true,
      isBinary: true,
      preDigest: baseline,
      postDigest,
      diffContent: null,
      blobPayload: Uint8Array.from(bytes),
    };
  }

  return {
    relativePath,
    changeKind,
    isChanged: true,
    isBinary: false,
    preDigest: baseline,
    postDigest,
    diffContent: createUnifiedDiff(
      relativePath,
      baselineText(input.baselinePayload, baseline),
      Buffer.from(bytes).toString('utf8'),
      changeKind === 'created' ? 'created' : 'modified',
    ),
    blobPayload: null,
  };
}
