import {
  isValidBrudKind,
  type BrudOperationKind,
} from '../../../src/contracts/brudOperation.js';
import { PARSER_DEFAULT_KIND } from '../contracts/kind.js';
import { parseParameters } from './parameters.js';
import { BRACE_PATTERN, BrudParseError, CALL_PATTERN } from './syntax.js';

export { BRUD_PARSE_ERROR, BrudParseError } from './syntax.js';

/** One `[CALL …]` … `[END]` block with its kind, name and parsed parameters. */
export interface ScannedCall {
  /** Operation kind declared by the header, or the default for a bare name. */
  readonly kind: BrudOperationKind;

  /** Operation name (tool or action name) taken from the opening marker. */
  readonly name: string;

  /** Parsed parameter map; protected values are literal strings. */
  readonly parameters: Readonly<Record<string, unknown>>;

  /** Absolute 1-based line number of the opening marker. */
  readonly line: number;
}

/**
 * Resolves the protected parameter names for an operation.
 *
 * The Parser is schema-agnostic and passes `undefined`, which makes every
 * brace region opaque. The hook stays injectable so a future syntax-only
 * profile can narrow the protected set without changing the scanner.
 */
export type ProtectedParameterResolver = (
  kind: BrudOperationKind,
  name: string,
) => readonly string[] | undefined;

const WRAPPER_OPEN = '[BRUD]';
const WRAPPER_CLOSE = '[/BRUD]';
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
 * Scans a full document into ordered operations.
 *
 * The wrapper is extracted first, then every `[CALL …]` is split at the first
 * `[END]` that is not inside a protected parameter.
 *
 * Header forms:
 * - `[CALL <name>]` — defaults to `kind: tool`.
 * - `[CALL <kind> <name>]` — explicit kind, e.g. `[CALL action list_sessions]`.
 *
 * @param raw - Untrusted model output.
 * @param resolveProtected - Protected-parameter resolver.
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

    const header = parseCallHeader(candidate.trim(), line + index);

    if (header === undefined) {
      throw new BrudParseError('expected [CALL <kind> <name>]', line + index);
    }

    const openingLine = line + index;
    const protectedNames = resolveProtected(header.kind, header.name);
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
      kind: header.kind,
      name: header.name,
      parameters: parseParameters(bodyLines, protectedNames, openingLine + 1),
      line: openingLine,
    });
  }

  if (calls.length === 0) {
    throw new BrudParseError('wrapper contains no [CALL] block', line);
  }

  return calls;
}

/** A parsed call header. */
interface CallHeader {
  readonly kind: BrudOperationKind;
  readonly name: string;
}

/**
 * Parses a `[CALL …]` header.
 *
 * One token is a bare operation name and defaults to `tool`; two tokens are
 * `<kind> <name>`. The kind must satisfy the shared kind grammar.
 *
 * @param trimmed - Trimmed header line.
 * @param line - Absolute 1-based line number for diagnostics.
 * @returns The header, or `undefined` when the line is not a call header.
 */
function parseCallHeader(trimmed: string, line: number): CallHeader | undefined {
  const match = CALL_PATTERN.exec(trimmed);

  if (match === null) {
    return undefined;
  }

  const first = match[1] ?? '';
  const second = match[2];

  if (first === '') {
    throw new BrudParseError('empty operation name in [CALL]', line);
  }

  if (second === undefined) {
    return { kind: PARSER_DEFAULT_KIND, name: first };
  }

  if (second === '') {
    throw new BrudParseError('empty operation name in [CALL]', line);
  }

  if (!isValidBrudKind(first)) {
    throw new BrudParseError(`invalid operation kind "${first}"`, line);
  }

  return { kind: first, name: second };
}

/** Whether a parameter is protected for an operation whose schema is known. */
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