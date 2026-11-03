import { parseParameters } from './parameters.js';
import { BRACE_PATTERN, BrudParseError } from './syntax.js';

export { BRUD_PARSE_ERROR, BrudParseError } from './syntax.js';

/** One `[CALL tool_name]` … `[END]` block with parsed parameters. */
export interface ScannedCall {
  /** Tool name taken from the opening `[CALL …]` marker. */
  readonly toolName: string;

  /** Parsed parameter map; protected values are literal strings. */
  readonly parameters: Readonly<Record<string, unknown>>;

  /** Absolute 1-based line number of the opening marker. */
  readonly line: number;
}

/**
 * Resolves the protected parameter names for a tool.
 *
 * Returns `undefined` when the tool has no registered schema. In that case the
 * scanner treats every brace region as opaque, because it cannot prove the
 * parameter unprotected; routing later reports `TOOL_NOT_FOUND`.
 */
export type ProtectedParameterResolver = (
  toolName: string,
) => readonly string[] | undefined;

const WRAPPER_OPEN = '[BRUD]';
const WRAPPER_CLOSE = '[/BRUD]';
const CALL_PATTERN = /^\[CALL\s+([^\]\s]+)\s*\]$/;
const END_MARKER = '[END]';

/**
 * Extracts the first `[BRUD]` … `[/BRUD]` wrapper body.
 *
 * Text outside the wrapper is ignored. A missing, reversed or unterminated
 * wrapper is a parse error.
 *
 * @param raw - Untrusted model output.
 * @returns The body between the markers and its first-line number.
 */
export function extractWrapper(raw: string): { readonly body: string; readonly line: number } {
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const open = text.indexOf(WRAPPER_OPEN);

  if (open < 0) {
    throw new BrudParseError('missing [BRUD] wrapper', lineAt(text, 0));
  }

  const close = text.indexOf(WRAPPER_CLOSE, open + WRAPPER_OPEN.length);

  if (close < 0) {
    throw new BrudParseError('unterminated [BRUD] wrapper', lineAt(text, open));
  }

  const bodyStart = open + WRAPPER_OPEN.length;

  return { body: text.slice(bodyStart, close), line: lineAt(text, bodyStart) };
}

/**
 * Scans a full document into ordered tool calls.
 *
 * The wrapper is extracted first, then every `[CALL name]` is split at the
 * first `[END]` that is not inside a protected parameter for that tool.
 *
 * @param raw - Untrusted model output.
 * @param resolveProtected - Protected-parameter resolver for a tool name.
 * @returns Ordered calls, each with parsed parameters.
 */
export function scanBrudDocument(
  raw: string,
  resolveProtected: ProtectedParameterResolver,
): readonly ScannedCall[] {
  const { body, line } = extractWrapper(raw);
  const lines = body.split('\n');
  const calls: ScannedCall[] = [];

  let index = 0;

  while (index < lines.length) {
    const candidate = lines[index] ?? '';

    if (candidate.trim() === '') {
      index += 1;
      continue;
    }

    const call = CALL_PATTERN.exec(candidate.trim());

    if (call === null) {
      throw new BrudParseError('expected [CALL tool_name]', line + index);
    }

    const toolName = call[1] ?? '';

    if (toolName === '') {
      throw new BrudParseError('empty tool name in [CALL]', line + index);
    }

    const openingLine = line + index;
    const protectedNames = resolveProtected(toolName);
    const bodyLines: string[] = [];

    index += 1;

    let closed = false;
    let activeProtected: string | null = null;

    while (index < lines.length) {
      const current = lines[index] ?? '';
      const trimmed = current.trim();

      if (activeProtected !== null) {
        if (trimmed === closer(activeProtected)) {
          activeProtected = null;
        }

        bodyLines.push(current);
        index += 1;
        continue;
      }

      if (trimmed === END_MARKER) {
        closed = true;
        index += 1;
        break;
      }

      const brace = BRACE_PATTERN.exec(trimmed);
      const braceName = brace?.[1] ?? '';

      if (
        brace !== null
        && !braceName.startsWith('/')
        && isProtected(protectedNames, braceName)
      ) {
        activeProtected = braceName;
      }

      if (CALL_PATTERN.test(trimmed)) {
        throw new BrudParseError('nested [CALL] is not allowed', line + index);
      }

      bodyLines.push(current);
      index += 1;
    }

    if (!closed) {
      throw new BrudParseError('missing [END] for [CALL]', openingLine);
    }

    calls.push({
      toolName,
      parameters: parseParameters(bodyLines, protectedNames, openingLine + 1),
      line: openingLine,
    });
  }

  if (calls.length === 0) {
    throw new BrudParseError('wrapper contains no [CALL] block', line);
  }

  return calls;
}

/**
 * Lists the top-level `properties` marked `protected: true`.
 *
 * The `protected` keyword is an annotation only; it never constrains a value.
 *
 * @param schema - Registered `parametersSchema` object.
 * @returns Protected parameter names, possibly empty.
 */
export function protectedParametersForSchema(
  schema: Readonly<Record<string, unknown>> | undefined,
): readonly string[] | undefined {
  if (schema === undefined) {
    return undefined;
  }

  const properties = schema.properties;

  if (properties === null || typeof properties !== 'object' || Array.isArray(properties)) {
    return [];
  }

  const names: string[] = [];

  for (const [name, child] of Object.entries(properties as Record<string, unknown>)) {
    if (
      child !== null
      && typeof child === 'object'
      && !Array.isArray(child)
      && (child as Record<string, unknown>).protected === true
    ) {
      names.push(name);
    }
  }

  return names;
}

/** Whether a parameter is protected for a tool whose schema is known. */
function isProtected(
  protectedNames: readonly string[] | undefined,
  name: string,
): boolean {
  return protectedNames === undefined || protectedNames.includes(name);
}

/** The own-line closer form for a protected parameter. */
function closer(name: string): string {
  return `{/${name}}`;
}

/** Computes the 1-based line number of a string offset. */
function lineAt(text: string, offset: number): number {
  let line = 1;

  for (let index = 0; index < offset; index += 1) {
    if (text[index] === '\n') {
      line += 1;
    }
  }

  return line;
}