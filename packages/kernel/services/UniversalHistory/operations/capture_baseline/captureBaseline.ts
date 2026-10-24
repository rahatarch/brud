import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { posix, win32 } from 'node:path';
import type { IBrudFileSystem } from '../../../BrudFileSystem/contracts/IBrudFileSystem/IBrudFileSystem.js';
import type {
  BaselineSnapshot,
  BaselineTarget,
  TargetDigest,
} from '../../contracts/IUniversalHistoryService/types.js';
import { InvalidBaselinePathError } from './types.js';
import type { CaptureBaselineInput } from './types.js';

/** Default number of leading bytes inspected for binary detection. */
export const DEFAULT_BINARY_PROBE_LENGTH = 8000;

const COLON_QUALIFIER_PATTERN = /^[A-Za-z]:/u;
const TRAILING_SEPARATOR_PATTERN = /\/+$/u;
const NULL_BYTE_PATTERN = /\0/u;

function normalizeRelativePath(candidate: string): string {
  if (candidate.length === 0) {
    throw new InvalidBaselinePathError(candidate, 'EMPTY_PATH');
  }

  if (NULL_BYTE_PATTERN.test(candidate)) {
    throw new InvalidBaselinePathError(candidate, 'NULL_BYTE');
  }

  const unified = candidate.replace(/\\/gu, '/').replace(TRAILING_SEPARATOR_PATTERN, '');

  if (unified.length === 0) {
    throw new InvalidBaselinePathError(candidate, 'EMPTY_PATH');
  }

  if (posix.isAbsolute(unified) || win32.isAbsolute(unified) || COLON_QUALIFIER_PATTERN.test(unified)) {
    throw new InvalidBaselinePathError(candidate, 'ABSOLUTE_PATH');
  }

  const normalized = posix.normalize(unified);

  if (normalized === '.') {
    throw new InvalidBaselinePathError(candidate, 'EMPTY_PATH');
  }

  if (normalized === '..' || normalized.startsWith('../')) {
    throw new InvalidBaselinePathError(candidate, 'PARENT_TRAVERSAL');
  }

  return normalized;
}

function normalizeTargets(relativePaths: readonly string[]): readonly string[] {
  const unique = new Set<string>();

  for (const candidate of relativePaths) {
    unique.add(normalizeRelativePath(candidate));
  }

  return [...unique];
}

/**
 * Detects binary content by scanning the leading bytes for a null byte.
 *
 * @param bytes - Raw file contents.
 * @param probeLength - Maximum number of leading bytes to inspect.
 */
export function detectBinaryContent(
  bytes: Uint8Array,
  probeLength: number = DEFAULT_BINARY_PROBE_LENGTH,
): boolean {
  const limit = Math.min(bytes.byteLength, Math.max(0, Math.floor(probeLength)));

  for (let index = 0; index < limit; index += 1) {
    if (bytes[index] === 0) {
      return true;
    }
  }

  return false;
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

async function captureTarget(
  fileSystem: IBrudFileSystem,
  relativePath: string,
  probeLength: number,
): Promise<BaselineTarget> {
  if (!(await fileSystem.exists(relativePath))) {
    return { digest: missingDigest(relativePath) };
  }

  const bytes = await fileSystem.readFile(relativePath);
  const isBinary = detectBinaryContent(bytes, probeLength);
  const digest: TargetDigest = {
    relativePath,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.byteLength,
    isBinary,
    exists: true,
  };

  if (isBinary) {
    return { content: Uint8Array.from(bytes), digest };
  }

  return { text: Buffer.from(bytes).toString('utf8'), digest };
}

/**
 * Captures a byte-safe baseline of workspace targets.
 *
 * Every key in the returned snapshot is a normalized, workspace-relative
 * path. Nonexistent targets are recorded with `exists: false` and an empty
 * digest instead of failing the capture.
 */
export async function captureBaseline(input: CaptureBaselineInput): Promise<BaselineSnapshot> {
  const probeLength = input.binaryProbeLength ?? DEFAULT_BINARY_PROBE_LENGTH;
  const targets = new Map<string, BaselineTarget>();

  for (const relativePath of normalizeTargets(input.relativePaths)) {
    targets.set(relativePath, await captureTarget(input.fileSystem, relativePath, probeLength));
  }

  return {
    sessionId: input.sessionId,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    targets: Object.fromEntries(targets),
  };
}
