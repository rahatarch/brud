export interface ImportPattern {
  regex: RegExp;
  type: 'import' | 'require' | 'dynamic' | 'type-import';
}

export interface LanguageImportPatterns {
  language: string;
  extensions: string[];
  patterns: ImportPattern[];
}

export const typescriptPatterns: LanguageImportPatterns = {
  language: 'typescript',
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'],
  patterns: [
    { regex: /import\s+type\s+\{[^}]*\}\s+from\s+['"]([^'"]+)['"]/g, type: 'type-import' },
    { regex: /import\s+type\s+\w+\s+from\s+['"]([^'"]+)['"]/g, type: 'type-import' },
    { regex: /import\s+\{[^}]*\btype\b[^}]*\}\s+from\s+['"]([^'"]+)['"]/g, type: 'type-import' },
    { regex: /import\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+(?:,\s*(?:\{[^}]*\}|\*\s+as\s+\w+))?)\s+from\s+['"]([^'"]+)['"]/g, type: 'import' },
    { regex: /export\s+\{[^}]*\}\s+from\s+['"]([^'"]+)['"]/g, type: 'import' },
    { regex: /export\s+\*\s+from\s+['"]([^'"]+)['"]/g, type: 'import' },
    { regex: /(?:const|let|var)\s+\w+\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g, type: 'require' },
    { regex: /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g, type: 'dynamic' },
  ],
};

export const pythonPatterns: LanguageImportPatterns = {
  language: 'python',
  extensions: ['.py', '.pyw'],
  patterns: [
    { regex: /^\s*import\s+(\S+)/gm, type: 'import' },
    { regex: /^\s*from\s+(\S+)\s+import/gm, type: 'import' },
  ],
};

export const goPatterns: LanguageImportPatterns = {
  language: 'go',
  extensions: ['.go'],
  patterns: [
    { regex: /import\s+['"]([^'"]+)['"]/g, type: 'import' },
    { regex: /import\s+\(\s*([\s\S]*?)\s*\)/g, type: 'import' },
  ],
};

export const rustPatterns: LanguageImportPatterns = {
  language: 'rust',
  extensions: ['.rs'],
  patterns: [
    { regex: /^\s*use\s+([^;]+);/gm, type: 'import' },
  ],
};

export const languagePatternsRegistry: LanguageImportPatterns[] = [
  typescriptPatterns,
  pythonPatterns,
  goPatterns,
  rustPatterns,
];

export function getPatternsForFile(filePath: string): LanguageImportPatterns {
  // `String.prototype.match` returns an array with `index`, `input`, and
  // `groups` properties; use the matched extension itself, never every value.
  const ext = filePath.match(/\.\w+$/)?.[0] ?? '';
  for (const entry of languagePatternsRegistry) {
    if (entry.extensions.includes(ext)) {
      return entry;
    }
  }
  return typescriptPatterns;
}

/**
 * Returns the import pattern table for an explicit language hint.
 *
 * This hint overrides file-extension detection when a caller knows the
 * language. Matching is case-insensitive. Extension detection also recognizes
 * `.py` on the default path; the hint remains available for extensionless
 * input or explicit overrides.
 *
 * @param language - Language name, e.g. `python` or `typescript`.
 * @returns The matching pattern table, or `undefined` for an unknown language.
 */
export function getPatternsForLanguage(language: string): LanguageImportPatterns | undefined {
  const normalized = language.toLowerCase();
  return languagePatternsRegistry.find((entry) => entry.language === normalized);
}