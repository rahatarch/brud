import * as path from 'node:path';
import { getPatternsForFile, getPatternsForLanguage } from './languagePatterns.js';
import type { ImportPattern } from './languagePatterns.js';
import { invalidImportSyntaxError, ImportResolutionError } from './errors.js';

export { ImportResolutionError, invalidImportSyntaxError } from './errors.js';
export {
  getPatternsForFile,
  getPatternsForLanguage,
  goPatterns,
  languagePatternsRegistry,
  pythonPatterns,
  rustPatterns,
  typescriptPatterns,
} from './languagePatterns.js';
export type { ImportPattern, LanguageImportPatterns } from './languagePatterns.js';

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
const INDEX_FILES = ['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.mjs', 'index.cjs', 'index.mts', 'index.cts'];

/** Reports whether a module specifier points outside the local source tree. */
export function isExternalPackage(moduleSpecifier: string): boolean {
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

  const resolvedExt = path.extname(resolved);
  if (resolvedExt && await fileExists(resolved)) {
    return resolved;
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

/**
 * Resolves every local import in a source string to a concrete file path.
 *
 * The function performs no filesystem access of its own: callers supply the
 * file contents and an `exists` probe, which keeps the resolver usable from
 * any host (kernel utility, editor adapter, or test).
 *
 * @param content - Source text to scan.
 * @param filePath - Path of the source file, used as the resolution base.
 * @param fileExists - Async existence probe supplied by the caller.
 * @param customPatterns - Optional replacement regex sources; capture group 1
 * must contain the module specifier.
 * @param language - Optional explicit language hint. When omitted, the file
 * extension selects the pattern table exactly as the legacy resolver does.
 * @returns Resolved local paths, in discovery order, without duplicates.
 */
export async function resolveImports(
  content: string,
  filePath: string,
  fileExists: (path: string) => Promise<boolean>,
  customPatterns?: readonly string[],
  language?: string,
): Promise<string[]> {
  const imports: string[] = [];
  const matches = new Set<string>();

  let patterns: ImportPattern[];

  if (customPatterns && customPatterns.length > 0) {
    patterns = [];
    for (const patternStr of customPatterns) {
      try {
        const regex = new RegExp(patternStr, 'g');
        patterns.push({ regex, type: 'import' });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw invalidImportSyntaxError(message);
      }
    }
  } else if (language !== undefined) {
    const entry = getPatternsForLanguage(language);

    if (entry === undefined) {
      throw new ImportResolutionError('INVALID_FIELD', `Unknown import language: ${language}`);
    }

    patterns = entry.patterns;
  } else {
    patterns = getPatternsForFile(filePath).patterns;
  }

  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(content)) !== null) {
      const specifier = match[1];
      if (specifier !== undefined && !isExternalPackage(specifier)) {
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

/**
 * Minimal read port required by {@link readFileWithImports}.
 *
 * `IBrudFileSystem` satisfies this contract, but the resolver does not depend
 * on the kernel package.
 */
export interface ImportContentReader {
  readText(filePath: string): Promise<string>;
  exists(filePath: string): Promise<boolean>;
}

/**
 * Reads a file and, up to `maxDepth` levels, every local file it imports.
 *
 * @param reader - File-content port.
 * @param filePath - Entry file path.
 * @param maxDepth - Import depth; `0` reads only the entry file.
 * @param excludePatterns - Substrings that exclude a path from traversal.
 * @param importSyntax - Optional replacement regex sources.
 * @returns Read contents keyed by path, plus per-file read failures.
 */
export async function readFileWithImports(
  reader: ImportContentReader,
  filePath: string,
  maxDepth: number,
  excludePatterns?: readonly string[],
  importSyntax?: readonly string[],
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
      const content = await reader.readText(currentPath);
      result.set(currentPath, content);

      if (depth > 0) {
        const imports = await resolveImports(content, currentPath, (p) => reader.exists(p), importSyntax);
        for (const importPath of imports) {
          await readRecursive(importPath, depth - 1);
        }
      }
    } catch (error: unknown) {
      errors.push({
        filePath: currentPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await readRecursive(filePath, maxDepth);
  return { files: result, errors };
}