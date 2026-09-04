export function isGlobPattern(text: string): boolean {
  return /[*?[\]}]/.test(text);
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
    } else if (ch === '.' || ch === '+' || ch === '^' || ch === '$' || ch === '{' || ch === '}' || ch === '(' || ch === ')' || ch === '|' || ch === '\\') {
      result += '\\' + ch;
      i++;
    } else {
      result += ch;
      i++;
    }
  }
  return result;
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