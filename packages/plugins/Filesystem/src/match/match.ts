/**
 * Pure single-match helpers, reimplemented from the frozen legacy surface
 * (the quarantined legacy engine's `types/legacy.ts:9-50`). They perform no I/O.
 */

export type MatchErrorCode = 'SEARCH_NOT_FOUND' | 'MULTIPLE_MATCHES';

export type MatchResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: MatchErrorCode; readonly message: string };

/** Locates exactly one occurrence of `searchText`. */
export function findSingleMatch(
  content: string,
  searchText: string,
): MatchResult<{ index: number }> {
  const firstIndex = content.indexOf(searchText);

  if (firstIndex === -1) {
    return {
      ok: false,
      code: 'SEARCH_NOT_FOUND',
      message: 'Search text was not found in the document.',
    };
  }

  const lastIndex = content.lastIndexOf(searchText);

  if (firstIndex !== lastIndex) {
    return {
      ok: false,
      code: 'MULTIPLE_MATCHES',
      message: 'Search text matched more than once in the document.',
    };
  }

  return { ok: true, value: { index: firstIndex } };
}

/** Removes `1 | ` numeric line prefixes from pasted context blocks. */
export function stripNumericLinePrefixes(text: string): string {
  return text.replace(/^\s*\d+\s*\|\s?/gm, '');
}

/** Replaces the single matching occurrence. */
export function applySingleMatch(
  content: string,
  searchText: string,
  replacement: string,
): MatchResult<{ content: string }> {
  const match = findSingleMatch(content, searchText);

  if (!match.ok) {
    return match;
  }

  const { index } = match.value;

  return {
    ok: true,
    value: {
      content:
        content.substring(0, index)
        + replacement
        + content.substring(index + searchText.length),
    },
  };
}