import type { ReadFileEntry, ReadLimitHit, ReadResult, ReadSkipEntry, ReadSkipReason } from '../read-engine/index.js';

export interface ReadEnvelopeEntry extends ReadResult {
  operationIndex: number;
}

export interface ReadEnvelope {
  readResults: ReadEnvelopeEntry[];
}

const SKIP_REASONS: readonly ReadSkipReason[] = ['binary', 'unreadable', 'excluded'];
const LIMIT_HITS: readonly ReadLimitHit[] = ['files', 'bytes'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isReadFileEntry(value: unknown): value is ReadFileEntry {
  return isRecord(value)
    && typeof value.path === 'string'
    && typeof value.size === 'number'
    && typeof value.startLine === 'number'
    && typeof value.endLine === 'number'
    && typeof value.totalLines === 'number'
    && (value.content === undefined || typeof value.content === 'string');
}

function isReadSkipEntry(value: unknown): value is ReadSkipEntry {
  return isRecord(value)
    && typeof value.path === 'string'
    && typeof value.reason === 'string'
    && (SKIP_REASONS as readonly string[]).includes(value.reason);
}

function isReadEnvelopeEntry(value: unknown): value is ReadEnvelopeEntry {
  if (!isRecord(value) || typeof value.operationIndex !== 'number') {
    return false;
  }
  if (typeof value.totalFiles !== 'number' || typeof value.totalSize !== 'number') {
    return false;
  }
  if (!isUnknownArray(value.files) || !value.files.every(isReadFileEntry)) {
    return false;
  }
  if (value.skips !== undefined) {
    if (!isUnknownArray(value.skips) || !value.skips.every(isReadSkipEntry)) {
      return false;
    }
  }
  if (value.truncated !== undefined && typeof value.truncated !== 'boolean') {
    return false;
  }
  if (value.limitHit !== undefined) {
    if (typeof value.limitHit !== 'string' || !(LIMIT_HITS as readonly string[]).includes(value.limitHit)) {
      return false;
    }
  }
  return true;
}

export function parseReadEnvelope(raw: string): ReadEnvelope {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || !isUnknownArray(parsed.readResults)) {
    throw new Error('Invalid read envelope');
  }
  const readResults = parsed.readResults.filter(isReadEnvelopeEntry);
  if (readResults.length !== parsed.readResults.length) {
    throw new Error('Invalid read envelope entry');
  }
  return { readResults };
}
