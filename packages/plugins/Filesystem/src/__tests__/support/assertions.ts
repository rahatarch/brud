/** Assertion and fake-dispatch helpers with no runtime kernel import. */
import type { OperationResult } from '@brud/kernel';
import type { ExecuteTool } from '../../search/index.js';

/** Deterministic `search_files` stand-in returning the supplied paths. */
export function fakeSearch(paths: readonly string[]): ExecuteTool {
  return async (name: string): Promise<OperationResult> => {
    if (name !== 'search_files') {
      return { status: 'failed', error: `TOOL_NOT_FOUND: ${name}` };
    }

    return {
      status: 'success',
      data: {
        results: paths.map((path) => ({ path })),
        totalMatches: paths.length,
        truncated: false,
      },
    };
  };
}

/** Returns `data.errors[0].code` for a failed tool result. */
export function errorCode(result: OperationResult): string | undefined {
  const data = result.data as {
    errors?: Array<{ code?: string }>;
  } | undefined;

  return data?.errors?.[0]?.code;
}