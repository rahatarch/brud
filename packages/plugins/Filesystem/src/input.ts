/** Input readers shared by the tool handlers. */
import { FilesystemError } from './errors/index.js';

function invalid(field: string, message: string): FilesystemError {
  return new FilesystemError(
    'VALIDATION_ERROR',
    undefined,
    `Invalid "${field}": ${message}`,
  );
}

/** Reads a string field, allowing an empty string. */
export function readString(input: Record<string, unknown>, field: string): string {
  const value = input[field];

  if (typeof value !== 'string') {
    throw invalid(field, 'expected a string.');
  }

  return value;
}

/** Reads a non-empty string field. */
export function readRequiredString(
  input: Record<string, unknown>,
  field: string,
): string {
  const value = readString(input, field);

  if (value.length === 0) {
    throw invalid(field, 'expected a non-empty string.');
  }

  return value;
}

/** Reads an optional non-empty string field. */
export function readOptionalString(
  input: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = input[field];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw invalid(field, 'expected a string.');
  }

  return value.length === 0 ? undefined : value;
}

/** Reads an optional string-array field. */
export function readOptionalStringArray(
  input: Record<string, unknown>,
  field: string,
): string[] | undefined {
  const value = input[field];

  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw invalid(field, 'expected an array of strings.');
  }

  return value.map((entry) => {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw invalid(field, 'expected every entry to be a non-empty string.');
    }

    return entry;
  });
}

/** Reads `position`, defaulting to `'end'`. */
export function readPosition(
  input: Record<string, unknown>,
  field = 'position',
): 'start' | 'end' {
  const value = input[field];

  if (value === undefined) {
    return 'end';
  }

  if (value === 'start' || value === 'end') {
    return value;
  }

  throw invalid(field, 'expected "start" or "end".');
}