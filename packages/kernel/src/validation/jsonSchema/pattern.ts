/**
 * `pattern` safety screen (decision U1-D2).
 *
 * ECMAScript `RegExp` has no time limit, so a hostile pattern can hang the
 * kernel thread. Patterns are screened at compile time for the shapes behind
 * catastrophic backtracking, then compiled once with the `u` flag. Combined
 * with the input-length cap applied at validation time, this bounds the risk.
 * It is a conservative heuristic, not a proof: some safe patterns (for example
 * `(ab|cd)*`) are rejected too.
 */

export type PatternScreenResult =
  | { readonly ok: true; readonly regex: RegExp }
  | { readonly ok: false; readonly code: 'UNSAFE_PATTERN' | 'INVALID_KEYWORD_VALUE'; readonly reason: string };

interface GroupFrame {
  hasRepeat: boolean;
  hasAlternation: boolean;
}

/**
 * Reads a quantifier starting at `index`.
 *
 * @returns The quantifier length and whether it can repeat its atom more than
 * once, or `null` when no quantifier starts here.
 */
function readQuantifier(source: string, index: number): { readonly length: number; readonly repeats: boolean } | null {
  const char = source[index];

  if (char === '*' || char === '+') {
    return { length: source[index + 1] === '?' ? 2 : 1, repeats: true };
  }
  if (char === '?') {
    return { length: source[index + 1] === '?' ? 2 : 1, repeats: false };
  }
  if (char === '{') {
    const match = /^\{(\d+)(,(\d*))?\}/u.exec(source.slice(index));
    if (match === null) {
      return null;
    }
    const min = Number(match[1]);
    const hasComma = match[2] !== undefined;
    const max = hasComma ? (match[3] === '' ? Number.POSITIVE_INFINITY : Number(match[3])) : min;
    const length = match[0].length + (source[index + match[0].length] === '?' ? 1 : 0);
    return { length, repeats: max > 1 };
  }
  return null;
}

/**
 * Screens and compiles a JSON Schema `pattern`.
 *
 * Rejected as `UNSAFE_PATTERN`:
 * - backreferences (`\1`…`\9`, `\k<name>`);
 * - lookbehind (`(?<=`, `(?<!`);
 * - a repeating quantifier applied to a group whose body contains a repeating
 *   quantifier (`(a+)+`, `(.*)*`) or an alternation (`(a|aa)*`).
 */
export function screenPattern(source: string, maxLength: number): PatternScreenResult {
  if (source.length > maxLength) {
    return { ok: false, code: 'UNSAFE_PATTERN', reason: `pattern is longer than ${maxLength} characters` };
  }

  const stack: GroupFrame[] = [{ hasRepeat: false, hasAlternation: false }];
  let index = 0;

  const top = (): GroupFrame => stack[stack.length - 1] as GroupFrame;

  while (index < source.length) {
    const char = source[index];

    if (char === '\\') {
      const next = source[index + 1];
      if (next !== undefined && /[1-9]/u.test(next)) {
        return { ok: false, code: 'UNSAFE_PATTERN', reason: 'backreferences are not allowed' };
      }
      if (next === 'k' && source[index + 2] === '<') {
        return { ok: false, code: 'UNSAFE_PATTERN', reason: 'named backreferences are not allowed' };
      }
      index += 2;
      const quantifier = readQuantifier(source, index);
      if (quantifier !== null) {
        if (quantifier.repeats) {
          top().hasRepeat = true;
        }
        index += quantifier.length;
      }
      continue;
    }

    if (char === '[') {
      index += 1;
      if (source[index] === '^') {
        index += 1;
      }
      if (source[index] === ']') {
        index += 1;
      }
      while (index < source.length && source[index] !== ']') {
        index += source[index] === '\\' ? 2 : 1;
      }
      index += 1;
      const quantifier = readQuantifier(source, index);
      if (quantifier !== null) {
        if (quantifier.repeats) {
          top().hasRepeat = true;
        }
        index += quantifier.length;
      }
      continue;
    }

    if (char === '(') {
      if (source.startsWith('(?<=', index) || source.startsWith('(?<!', index)) {
        return { ok: false, code: 'UNSAFE_PATTERN', reason: 'lookbehind is not allowed' };
      }
      stack.push({ hasRepeat: false, hasAlternation: false });
      index += 1;
      continue;
    }

    if (char === ')') {
      if (stack.length === 1) {
        return { ok: false, code: 'INVALID_KEYWORD_VALUE', reason: 'unbalanced parenthesis' };
      }
      const frame = stack.pop() as GroupFrame;
      index += 1;
      const quantifier = readQuantifier(source, index);
      if (quantifier !== null) {
        if (quantifier.repeats && (frame.hasRepeat || frame.hasAlternation)) {
          return {
            ok: false,
            code: 'UNSAFE_PATTERN',
            reason: 'a repeated group may not contain a repeating quantifier or an alternation',
          };
        }
        if (quantifier.repeats) {
          top().hasRepeat = true;
        }
        index += quantifier.length;
      }
      if (frame.hasRepeat) {
        top().hasRepeat = true;
      }
      if (frame.hasAlternation) {
        top().hasAlternation = true;
      }
      continue;
    }

    if (char === '|') {
      top().hasAlternation = true;
      index += 1;
      continue;
    }

    index += 1;
    const quantifier = readQuantifier(source, index);
    if (quantifier !== null) {
      if (quantifier.repeats) {
        top().hasRepeat = true;
      }
      index += quantifier.length;
    }
  }

  try {
    return { ok: true, regex: new RegExp(source, 'u') };
  } catch (error: unknown) {
    return {
      ok: false,
      code: 'INVALID_KEYWORD_VALUE',
      reason: `pattern is not a valid regular expression: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
