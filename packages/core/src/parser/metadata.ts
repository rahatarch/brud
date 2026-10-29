import { SessionMetadata } from '../types/patch';
import { BrudError } from '../api/index';
import { validateMetadata } from '../api/validationFacade';
import type { MetadataRule } from '@brud/kernel' with { 'resolution-mode': 'import' };

/**
 * Builds the legacy `E_*` metadata error through the kernel member-check.
 *
 * The parser owns the detection order (it sees the document); the kernel owns
 * the rule id, traits and exact legacy text, so every metadata failure has one
 * definition instead of a second bespoke factory (audit F-3).
 *
 * @param rule - Metadata rule being reported.
 * @param values - Wrapper, operation index or offending field.
 * @param reason - Explanation surfaced verbatim.
 */
function metadataError(
  rule: MetadataRule,
  values: { readonly wrapper?: string; readonly index?: string; readonly field?: string },
  reason: string,
): BrudError {
  const result = validateMetadata(rule, values, reason);

  return new BrudError({
    code: result.code ?? 'VALIDATION_ERROR',
    friendly: result.friendly ?? reason,
    details: result.details ?? reason,
  });
}

const SESSION_OPEN = '<session_metadata>';
const SESSION_CLOSE = '</session_metadata>';
const OPERATION_OPEN = '<operation_metadata>';
const OPERATION_CLOSE = '</operation_metadata>';
const VALID_FIELDS = new Set(['title:', 'description:']);

/**
 * Classifies an offending field name as a case error or an unknown field.
 *
 * @param field - Field token as written by the author.
 */
function metadataFieldError(field: string): BrudError {
  const stripped = field.endsWith(':') ? field.slice(0, -1) : field;
  const lower = stripped.toLowerCase();

  return lower === 'title' || lower === 'description'
    ? metadataError('INPUT.METADATA_FIELD_CASE', { field }, `metadata field "${field}" must be lowercase`)
    : metadataError('INPUT.METADATA_UNKNOWN_FIELD', { field }, `unknown metadata field "${field}"`);
}

function parseKeyValueLines(content: string): SessionMetadata {
  const result: SessionMetadata = {};
  const lines = content.split(/\r?\n/);
  let currentField: 'title' | 'description' | null = null;
  let currentValue: string[] = [];

  function flushField() {
    if (currentField) {
      const val = currentValue.join('\n');
      if (currentField === 'title') {
        result.title = val;
      } else {
        result.description = val;
      }
      currentField = null;
      currentValue = [];
    }
  }

  for (const rawLine of lines) {
    const line = rawLine;

    if (currentField) {
      if (line.length > 0 && (line[0] === ' ' || line[0] === '\t')) {
        currentValue.push(line.trimStart());
        continue;
      }
      flushField();
    }

    if (line.trim() === '') {
      continue;
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      const firstWord = line.split(/\s+/)[0] || line;
      throw metadataFieldError(firstWord);
    }

    const fieldName = line.slice(0, colonIdx + 1);
    let fieldValue = line.slice(colonIdx + 1);

    if (!VALID_FIELDS.has(fieldName)) {
      throw metadataFieldError(fieldName);
    }

    fieldValue = fieldValue.trimStart();

    const fieldKey = fieldName === 'title:' ? 'title' : 'description';

    if (fieldValue === '') {
      currentField = fieldKey;
      currentValue = [];
    } else {
      currentField = fieldKey;
      currentValue = [fieldValue];
    }
  }

  flushField();

  return result;
}

interface BlockRange {
  startLine: number;
  endLine: number;
}

function findOperationBlockRanges(lines: string[]): BlockRange[] {
  const blocks: BlockRange[] = [];
  let currentBlockStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^<<<<<<<\s+\w+/.test(line)) {
      currentBlockStart = i;
    } else if (/^>>>>>>>\s+END\s+\w+/.test(line)) {
      if (currentBlockStart !== -1) {
        blocks.push({ startLine: currentBlockStart, endLine: i });
        currentBlockStart = -1;
      }
    }
  }

  return blocks;
}

function extractOperationIndex(lines: string[], opStartLine: number): string {
  const headerLine = lines[opStartLine];
  const match = headerLine.match(/\[(\d+)\]/);
  return match ? match[1] : String(opStartLine);
}

export function extractMetadata(input: string): {
  cleanedInput: string;
  sessionMetadata?: SessionMetadata;
  operationMetadata: Map<string, SessionMetadata>;
} {
  const lines = input.split(/\r?\n/);
  const operationMetadata = new Map<string, SessionMetadata>();
  let sessionMetadata: SessionMetadata | undefined;
  let sessionMetadataFound = false;
  const cleanedLines: string[] = [];
  const blockRanges = findOperationBlockRanges(lines);

  function findOpIndexForLine(lineIdx: number): string | null {
    for (const block of blockRanges) {
      if (lineIdx >= block.startLine && lineIdx <= block.endLine) {
        return extractOperationIndex(lines, block.startLine);
      }
    }
    return null;
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      cleanedLines.push(line);
      i++;
      continue;
    }

    const trimmed = line.trim();

    if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
      const lower = trimmed.toLowerCase();
      const isSessionOpen = lower === SESSION_OPEN;
      const isSessionClose = lower === SESSION_CLOSE;
      const isOpOpen = lower === OPERATION_OPEN;
      const isOpClose = lower === OPERATION_CLOSE;

      if (isSessionOpen || isSessionClose || isOpOpen || isOpClose) {
        const correctTag = trimmed === SESSION_OPEN || trimmed === SESSION_CLOSE ||
                           trimmed === OPERATION_OPEN || trimmed === OPERATION_CLOSE;
        if (!correctTag) {
          throw metadataError('INPUT.METADATA_WRONG_CASE', { wrapper: trimmed.slice(1, -1) }, 'metadata wrapper must be lowercase');
        }

        if (isSessionOpen) {
          if (sessionMetadataFound) {
            throw metadataError('INPUT.DUPLICATE_SESSION_METADATA', {}, 'duplicate session metadata block');
          }
          if (i !== 0) {
            throw metadataError('INPUT.SESSION_METADATA_POSITION', { wrapper: 'session_metadata' }, 'session metadata is out of position');
          }
          sessionMetadataFound = true;
          i++;
          const contentLines: string[] = [];
          let closed = false;
          while (i < lines.length) {
            const innerLine = lines[i];
            const innerTrimmed = innerLine.trim();
            if (innerTrimmed === SESSION_CLOSE) {
              closed = true;
              if (contentLines.some(cl => cl.trim() !== '')) {
                sessionMetadata = parseKeyValueLines(contentLines.join('\n'));
              }
              i++;
              break;
            }
            if (innerTrimmed.startsWith('<') && innerTrimmed.endsWith('>') &&
                innerTrimmed.toLowerCase() === SESSION_CLOSE && innerTrimmed !== SESSION_CLOSE) {
              throw metadataError('INPUT.METADATA_WRONG_CASE', { wrapper: innerTrimmed.slice(1, -1) }, 'metadata wrapper must be lowercase');
            }
            contentLines.push(innerLine);
            i++;
          }
          if (!closed) {
            throw metadataError('INPUT.METADATA_UNCLOSED', { wrapper: 'session_metadata' }, 'unclosed session metadata wrapper');
          }
          continue;
        }

        if (isSessionClose && !sessionMetadataFound) {
          throw metadataError('INPUT.METADATA_UNCLOSED', { wrapper: 'session_metadata' }, 'unclosed session metadata wrapper');
        }

        if (isOpOpen) {
          const opIndex = findOpIndexForLine(i);
          const key = opIndex || String(operationMetadata.size + 1);

          if (operationMetadata.has(key)) {
            throw metadataError('INPUT.DUPLICATE_OPERATION_METADATA', { index: key }, 'duplicate operation metadata block');
          }

          i++;
          const contentLines: string[] = [];
          let closed = false;
          while (i < lines.length) {
            const innerLine = lines[i];
            const innerTrimmed = innerLine.trim();
            if (innerTrimmed === OPERATION_CLOSE) {
              closed = true;
              if (contentLines.some(cl => cl.trim() !== '')) {
                operationMetadata.set(key, parseKeyValueLines(contentLines.join('\n')));
              }
              i++;
              break;
            }
            if (innerTrimmed.startsWith('<') && innerTrimmed.endsWith('>') &&
                innerTrimmed.toLowerCase() === OPERATION_CLOSE && innerTrimmed !== OPERATION_CLOSE) {
              throw metadataError('INPUT.METADATA_WRONG_CASE', { wrapper: innerTrimmed.slice(1, -1) }, 'metadata wrapper must be lowercase');
            }
            contentLines.push(innerLine);
            i++;
          }
          if (!closed) {
            throw metadataError('INPUT.METADATA_UNCLOSED', { wrapper: 'operation_metadata' }, 'unclosed operation metadata wrapper');
          }
          continue;
        }

        if (isOpClose) {
          i++;
          continue;
        }
      }
    }

    cleanedLines.push(line);
    i++;
  }

  const cleanedInput = cleanedLines.join('\n');

  return {
    cleanedInput,
    sessionMetadata,
    operationMetadata,
  };
}

export function parseMetadataLines(content: string): SessionMetadata {
  return parseKeyValueLines(content);
}