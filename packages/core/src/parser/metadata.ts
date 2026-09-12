import { SessionMetadata } from '../types/patch';
import {
  metadataWrapperCaseError,
  duplicateMetadataError,
  invalidMetadataFieldError,
  metadataPositionError,
  unterminatedMetadataError,
} from '../api/errors';
import { BrudError } from '../api/index';

const SESSION_OPEN = '<session_metadata>';
const SESSION_CLOSE = '</session_metadata>';
const OPERATION_OPEN = '<operation_metadata>';
const OPERATION_CLOSE = '</operation_metadata>';
const VALID_FIELDS = new Set(['title:', 'description:']);

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
      throw new BrudError(invalidMetadataFieldError(firstWord));
    }

    const fieldName = line.slice(0, colonIdx + 1);
    let fieldValue = line.slice(colonIdx + 1);

    if (!VALID_FIELDS.has(fieldName)) {
      throw new BrudError(invalidMetadataFieldError(fieldName));
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
          throw new BrudError(metadataWrapperCaseError(trimmed.slice(1, -1)));
        }

        if (isSessionOpen) {
          if (sessionMetadataFound) {
            throw new BrudError(duplicateMetadataError('session'));
          }
          if (i !== 0) {
            throw new BrudError(metadataPositionError('session_metadata'));
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
              throw new BrudError(metadataWrapperCaseError(innerTrimmed.slice(1, -1)));
            }
            contentLines.push(innerLine);
            i++;
          }
          if (!closed) {
            throw new BrudError(unterminatedMetadataError('session_metadata'));
          }
          continue;
        }

        if (isSessionClose && !sessionMetadataFound) {
          throw new BrudError(unterminatedMetadataError('session_metadata'));
        }

        if (isOpOpen) {
          const opIndex = findOpIndexForLine(i);
          const key = opIndex || String(operationMetadata.size + 1);

          if (operationMetadata.has(key)) {
            throw new BrudError(duplicateMetadataError('operation', key));
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
              throw new BrudError(metadataWrapperCaseError(innerTrimmed.slice(1, -1)));
            }
            contentLines.push(innerLine);
            i++;
          }
          if (!closed) {
            throw new BrudError(unterminatedMetadataError('operation_metadata'));
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