export function isGlobPattern(text: string): boolean {
  return /[*?[\]{}]/.test(text);
}

export function matchGlob(pattern: string, path: string): boolean {
  const regexStr = patternToRegex(pattern);
  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(path);
}

function patternToRegex(pattern: string): string {
  let i = 0;
  let result = '';
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        result += '.*';
        i += 3;
      } else {
        result += '.*';
        i += 2;
      }
    } else if (ch === '*') {
      result += '[^/]*';
      i++;
    } else if (ch === '?') {
      result += '[^/]';
      i++;
    } else if (ch === '[') {
      const closeBracket = pattern.indexOf(']', i);
      if (closeBracket === -1) {
        result += '\\[';
        i++;
      } else {
        const charClass = pattern.slice(i + 1, closeBracket);
        result += '[' + escapeCharClass(charClass) + ']';
        i = closeBracket + 1;
      }
    } else if (ch === '{') {
      const closing = findMatchingBrace(pattern, i);
      const alternatives = closing !== -1 ? splitBraceAlternatives(pattern.slice(i + 1, closing)) : [];
      if (closing !== -1 && alternatives.length > 1) {
        result += '(?:' + alternatives.map(a => patternToRegex(a)).join('|') + ')';
        i = closing + 1;
      } else {
        result += '\\{';
        i++;
      }
    } else if (ch === '.' || ch === '+' || ch === '^' || ch === '$' || ch === '}' || ch === '(' || ch === ')' || ch === '|' || ch === '\\') {
      result += '\\' + ch;
      i++;
    } else {
      result += ch;
      i++;
    }
  }
  return result;
}

function findMatchingBrace(pattern: string, openIndex: number): number {
  let depth = 0;
  for (let j = openIndex; j < pattern.length; j++) {
    if (pattern[j] === '{') {
      depth++;
    } else if (pattern[j] === '}') {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

function splitBraceAlternatives(inner: string): string[] {
  const alternatives: string[] = [];
  let current = '';
  let depth = 0;
  for (const char of inner) {
    if (char === '{') {
      depth++;
      current += char;
    } else if (char === '}') {
      depth--;
      current += char;
    } else if (char === ',' && depth === 0) {
      alternatives.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  alternatives.push(current);
  return alternatives;
}

function escapeCharClass(classStr: string): string {
  let result = '';
  for (let i = 0; i < classStr.length; i++) {
    const ch = classStr[i];
    if (ch === ']' || ch === '\\' || ch === '^' || ch === '-') {
      if (ch === ']' || ch === '\\') {
        result += '\\' + ch;
      } else {
        result += ch;
      }
    } else {
      result += ch;
    }
  }
  return result;
}