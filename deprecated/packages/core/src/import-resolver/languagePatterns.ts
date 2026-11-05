export interface ImportPattern {
  regex: RegExp;
  type: 'import' | 'require' | 'dynamic' | 'type-import';
}

export interface LanguageImportPatterns {
  language: string;
  extensions: string[];
  patterns: ImportPattern[];
}

const typescriptPatterns: LanguageImportPatterns = {
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

const pythonPatterns: LanguageImportPatterns = {
  language: 'python',
  extensions: ['.py', '.pyw'],
  patterns: [
    { regex: /^\s*import\s+(\S+)/gm, type: 'import' },
    { regex: /^\s*from\s+(\S+)\s+import/gm, type: 'import' },
  ],
};

const goPatterns: LanguageImportPatterns = {
  language: 'go',
  extensions: ['.go'],
  patterns: [
    { regex: /import\s+['"]([^'"]+)['"]/g, type: 'import' },
    { regex: /import\s+\(\s*([\s\S]*?)\s*\)/g, type: 'import' },
  ],
};

const rustPatterns: LanguageImportPatterns = {
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
  const ext = Object.values(filePath.match(/\.\w+$/) || []).join('');
  for (const entry of languagePatternsRegistry) {
    if (entry.extensions.includes(ext)) {
      return entry;
    }
  }
  return typescriptPatterns;
}