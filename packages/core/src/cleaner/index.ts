const BRUD_INSTRUCTIONS_REGEX = /<\s*BRUD_INSTRUCTIONS\s*>([\s\S]*?)<\s*\/\s*BRUD_INSTRUCTIONS\s*>/gi;

export function cleanBrudInput(raw: string): string {
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = BRUD_INSTRUCTIONS_REGEX.exec(raw)) !== null) {
    matches.push(match[1]);
  }
  if (matches.length === 0) {
    return raw;
  }
  return matches.join('\n').trim();
}