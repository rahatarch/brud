import { BRACE_PATTERN, BrudParseError, KEY_PATTERN } from './syntax.js';

/**
 * Parses `key: value` parameters and `{param}` … `{/param}` protected regions.
 *
 * Plain parameters are single-line and trimmed. Protected content is captured
 * byte-for-byte between its own-line markers, including blank lines, braces and
 * protocol-like markers. Duplicate keys and malformed lines fail closed.
 *
 * @param lines - Block body lines, opener excluded and `[END]` excluded.
 * @param protectedNames - Protected names for the operation, or `undefined`
 * when every brace region is opaque (the schema-agnostic Parser default).
 * @param firstLine - Absolute 1-based line number of the first body line.
 * @returns The parsed parameter map.
 */
export function parseParameters(
  lines: readonly string[],
  protectedNames: readonly string[] | undefined,
  firstLine: number,
): Readonly<Record<string, unknown>> {
  const parameters: Record<string, unknown> = {};
  const seen = new Set<string>();

  let index = 0;

  while (index < lines.length) {
    const rawLine = lines[index] ?? '';
    const line = firstLine + index;
    const trimmed = rawLine.trim();

    if (trimmed === '') {
      index += 1;
      continue;
    }

    const brace = BRACE_PATTERN.exec(trimmed);
    const braceName = brace?.[1] ?? '';

    if (brace !== null && !braceName.startsWith('/') && isProtected(protectedNames, braceName)) {
      if (seen.has(braceName)) {
        throw new BrudParseError(`duplicate parameter "${braceName}"`, line);
      }

      const closedAt = findCloser(lines, index + 1, braceName);

      if (closedAt < 0) {
        throw new BrudParseError(`unterminated protected parameter "${braceName}"`, line);
      }

      seen.add(braceName);
      parameters[braceName] = lines.slice(index + 1, closedAt).join('\n');
      index = closedAt + 1;
      continue;
    }

    if (brace !== null) {
      throw new BrudParseError(
        `unprotected parameter "${braceName}" must not use brace form`,
        line,
      );
    }

    const parameter = KEY_PATTERN.exec(trimmed);

    if (parameter === null) {
      throw new BrudParseError('expected a "key: value" parameter', line);
    }

    const key = parameter[1] ?? '';
    const value = (parameter[2] ?? '').trim();

    if (isDeclaredProtected(protectedNames, key)) {
      throw new BrudParseError(
        `protected parameter "${key}" requires the {${key}} … {/${key}} form`,
        line,
      );
    }

    if (seen.has(key)) {
      throw new BrudParseError(`duplicate parameter "${key}"`, line);
    }

    seen.add(key);
    parameters[key] = value;
    index += 1;
  }

  return Object.freeze(parameters);
}

/**
 * Whether a brace region is protected.
 *
 * `undefined` means the schema is unknown and every brace region is opaque.
 */
function isProtected(
  protectedNames: readonly string[] | undefined,
  name: string,
): boolean {
  return protectedNames === undefined || protectedNames.includes(name);
}

/**
 * Whether a plain `key: value` parameter is declared protected.
 *
 * Only an explicit schema declaration can force the brace form; when the
 * schema is unknown, plain parameters remain admissible.
 */
function isDeclaredProtected(
  protectedNames: readonly string[] | undefined,
  name: string,
): boolean {
  return protectedNames !== undefined && protectedNames.includes(name);
}

/** Finds the own-line closer for a protected region, or -1 when absent. */
function findCloser(lines: readonly string[], from: number, name: string): number {
  const expected = `{/${name}}`;

  for (let index = from; index < lines.length; index += 1) {
    if ((lines[index] ?? '').trim() === expected) {
      return index;
    }
  }

  return -1;
}