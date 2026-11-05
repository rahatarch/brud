/**
 * Bridge from the legacy `pattern` / `scope` / `exclude` surface to the
 * Search plugin's strict `search_files` schema.
 */
import type { OperationResult } from '@brud/kernel';
import { FilesystemError } from '../errors/index.js';

/** Maximum accepted glob pattern length. */
export const MAX_PATTERN_LENGTH = 1024;

/** Maximum accepted brace-group nesting count. */
export const MAX_BRACE_GROUPS = 32;

export type ExecuteTool = (
  name: string,
  input: unknown,
) => Promise<OperationResult>;

export interface SearchBridgeRequest {
  pattern: string;
  scope?: string;
  exclude?: readonly string[];
}

/** Validates a glob pattern before it reaches the Search plugin. */
export function validatePattern(pattern: string): void {
  if (typeof pattern !== 'string' || pattern.trim().length === 0) {
    throw new FilesystemError(
      'VALIDATION_ERROR',
      undefined,
      'The field "pattern" is required.',
    );
  }

  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new FilesystemError(
      'VALIDATION_ERROR',
      undefined,
      `Glob pattern exceeds ${MAX_PATTERN_LENGTH} characters.`,
    );
  }

  const braceGroups = (pattern.match(/\{/gu) ?? []).length;

  if (braceGroups > MAX_BRACE_GROUPS) {
    throw new FilesystemError(
      'VALIDATION_ERROR',
      undefined,
      `Glob pattern contains too many brace groups (limit ${MAX_BRACE_GROUPS}).`,
    );
  }
}

function pathsFrom(result: OperationResult): string[] {
  const data = result.data as { results?: unknown } | undefined;

  if (data === undefined || !Array.isArray(data.results)) {
    throw new FilesystemError(
      'SEARCH_FAILED',
      undefined,
      'The search tool returned an invalid result payload.',
    );
  }

  const paths: string[] = [];

  for (const entry of data.results) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }

    const path = (entry as { path?: unknown }).path;

    if (typeof path === 'string' && path.length > 0) {
      paths.push(path);
    }
  }

  return [...new Set(paths)].sort();
}

/**
 * Resolves matching workspace-relative files through `search_files`.
 *
 * The Search plugin schema requires `patterns: string[]`, so the legacy
 * singular `pattern` is wrapped, `scope` becomes `directory`, and `exclude`
 * becomes `excludePatterns`.
 */
export async function resolveSearchFiles(
  executeTool: ExecuteTool,
  request: SearchBridgeRequest,
): Promise<string[]> {
  validatePattern(request.pattern);

  const payload: Record<string, unknown> = {
    patterns: [request.pattern],
  };

  if (request.scope !== undefined && request.scope.length > 0) {
    payload.directory = request.scope;
  }

  if (request.exclude !== undefined && request.exclude.length > 0) {
    payload.excludePatterns = [...request.exclude];
  }

  let result: OperationResult;

  try {
    result = await executeTool('search_files', payload);
  } catch (error: unknown) {
    throw new FilesystemError(
      'SEARCH_FAILED',
      undefined,
      `search_files failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  if (result.status !== 'success') {
    const message = typeof result.error === 'string'
      ? result.error
      : result.error instanceof Error
        ? result.error.message
        : result.message ?? 'search_files failed.';

    throw new FilesystemError('SEARCH_FAILED', undefined, message);
  }

  return pathsFrom(result);
}