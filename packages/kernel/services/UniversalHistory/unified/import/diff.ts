/**
 * Unified-diff reconstruction, ported from the legacy session ledger's
 * reversal planner (`operations/plan_reversal/planReversal.ts`). The legacy
 * ledger stored small text changes as a diff and rebuilt the other side on
 * demand; the importer uses this once, at import time, to recover full bytes.
 * Ported rather than imported so the importer survives deletion of the legacy
 * modules (U-7). Behaviour must stay identical to the original.
 */

const LINE_PATTERN = /[^\n]*\n|[^\n]+$/gu;
const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u;
const NO_NEWLINE_MARKER = '\\';

type DiffEntryType = 'equal' | 'delete' | 'insert';

interface DiffEntry {
  readonly type: DiffEntryType;
  line: string;
}

interface DiffHunk {
  readonly oldStart: number;
  readonly newStart: number;
  readonly entries: readonly DiffEntry[];
}

export function splitTextLines(text: string): readonly string[] {
  return text.match(LINE_PATTERN) ?? [];
}

function parseHunks(diff: string): readonly DiffHunk[] {
  const lines = splitTextLines(diff);
  const hunks: DiffHunk[] = [];
  let index = 0;

  while (index < lines.length) {
    const header = HUNK_HEADER_PATTERN.exec(lines[index] as string);
    if (header === null) {
      index += 1;
      continue;
    }
    const oldStart = Number.parseInt(header[1] as string, 10);
    const newStart = Number.parseInt(header[3] as string, 10);
    const entries: DiffEntry[] = [];
    index += 1;

    while (index < lines.length && HUNK_HEADER_PATTERN.exec(lines[index] as string) === null) {
      const raw = lines[index] as string;
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
    hunks.push({ oldStart, newStart, entries });
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

function applyHunks(baseLines: readonly string[], hunks: readonly DiffHunk[], direction: 'forward' | 'reverse'): readonly string[] {
  const forward = direction === 'forward';
  const output: string[] = [];
  let cursor = 0;

  for (const hunk of hunks) {
    const startIndex = Math.max(0, (forward ? hunk.oldStart : hunk.newStart) - 1);
    while (cursor < startIndex && cursor < baseLines.length) {
      output.push(baseLines[cursor] as string);
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
    output.push(baseLines[cursor] as string);
    cursor += 1;
  }
  return output;
}

/** Applies a stored unified diff to `base` (reverse: post → pre; forward: pre → post). */
export function reconstructText(diff: string, base: Uint8Array | null, direction: 'forward' | 'reverse'): Uint8Array {
  const baseText = base === null ? '' : new TextDecoder().decode(base);
  return new TextEncoder().encode(applyHunks(splitTextLines(baseText), parseHunks(diff), direction).join(''));
}
