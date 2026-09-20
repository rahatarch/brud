export function detectFields(content: string): string[] {
  const matches = content.matchAll(/\$\{\[([^\[\]]+)\]\}/g);
  return [...new Set([...matches].map(m => m[1].trim()))].filter(Boolean);
}

export function substituteFields(content: string, values: Record<string, string>): string {
  return content.replace(/\$\{\[([^\[\]]+)\]\}/g, (_, key) => {
    const trimmed = key.trim();
    return values[trimmed] ?? `\${[${trimmed}]}`;
  });
}