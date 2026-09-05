import path from 'path';
import { FileSystem } from '../types/filesystem.js';
import { getPatternsForFile } from './languagePatterns.js';

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
const INDEX_FILES = ['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.mjs', 'index.cjs', 'index.mts', 'index.cts'];

function isExternalPackage(moduleSpecifier: string): boolean {
  return !moduleSpecifier.startsWith('.') && !moduleSpecifier.startsWith('/');
}

async function resolveModulePath(
  moduleSpecifier: string,
  filePath: string,
  fileExists: (path: string) => Promise<boolean>,
): Promise<string | null> {
  const dir = path.dirname(filePath);
  const resolved = path.resolve(dir, moduleSpecifier);

  if (EXTENSIONS.some(ext => resolved.endsWith(ext))) {
    return (await fileExists(resolved)) ? resolved : null;
  }

  for (const ext of EXTENSIONS) {
    const withExt = resolved + ext;
    if (await fileExists(withExt)) return withExt;
  }

  for (const indexFile of INDEX_FILES) {
    const indexPath = path.join(resolved, indexFile);
    if (await fileExists(indexPath)) return indexPath;
  }

  return null;
}

export async function resolveImports(content: string, filePath: string, fileExists: (path: string) => Promise<boolean>): Promise<string[]> {
  const imports: string[] = [];
  const matches = new Set<string>();
  const patterns = getPatternsForFile(filePath);

  for (const pattern of patterns.patterns) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(content)) !== null) {
      const specifier = match[1];
      if (!isExternalPackage(specifier)) {
        matches.add(specifier);
      }
    }
  }

  for (const specifier of matches) {
    const resolved = await resolveModulePath(specifier, filePath, fileExists);
    if (resolved) {
      imports.push(resolved);
    }
  }

  return imports;
}

export interface ReadError {
  filePath: string;
  error: string;
}

export async function readFileWithImports(
  fs: FileSystem,
  filePath: string,
  maxDepth: number,
  excludePatterns?: string[],
): Promise<{ files: Map<string, string>; errors: ReadError[] }> {
  const result = new Map<string, string>();
  const visited = new Set<string>();
  const errors: ReadError[] = [];

  async function readRecursive(currentPath: string, depth: number): Promise<void> {
    if (visited.has(currentPath)) return;
    visited.add(currentPath);

    if (excludePatterns) {
      for (const pattern of excludePatterns) {
        if (currentPath.includes(pattern)) return;
      }
    }

    try {
      const content = await fs.readFile(currentPath);
      result.set(currentPath, content);

      if (depth > 0) {
        const imports = await resolveImports(content, currentPath, (p) => fs.exists(p));
        for (const importPath of imports) {
          await readRecursive(importPath, depth - 1);
        }
      }
    } catch (error) {
      errors.push({ filePath: currentPath, error: error instanceof Error ? error.message : String(error) });
    }
  }

  await readRecursive(filePath, maxDepth);
  return { files: result, errors };
}