import { PatchBlock, FileOperation, SessionMetadata } from '../types/patch';
import { parseLegacyFormat } from './legacy';
import { parseYamlFormat } from './yaml';
import { parseError } from '../api/errors';
import { BrudError } from '../api/index';
import { extractMetadata } from './metadata';

export function parseOperations(input: string, workspaceFolders: string[] = []): FileOperation[] {
  const trimmed = input.trim();

  const legacyPatterns = [
    '<<<<<<< SEARCH',
    '<<<<<<< CREATE_FILE',
    '<<<<<<< DELETE_FILE',
    '<<<<<<< RENAME_FILE',
    '<<<<<<< MOVE_FILE',
    '<<<<<<< COPY_FILE',
    '<<<<<<< APPEND_FILE',
    '<<<<<<< CREATE_DIRECTORY',
    '<<<<<<< DELETE_DIRECTORY',
    '<<<<<<< MOVE_DIRECTORY',
    '<<<<<<< EXTRACT_STRUCTURE',
    '<<<<<<< CODEBASE_METADATA',
    '<<<<<<< SEARCH_FILES',
    '<<<<<<< APPEND_FILE_MULTI',
    '<<<<<<< SEARCH_REPLACE_MULTI',
    '<<<<<<< READ_FILE',
    '<<<<<<< READ_FILES',
    '<<<<<<< READ_DIRECTORY',
    '<<<<<<< TERMINAL_INTERACTIVE',
    '<<<<<<< TERMINAL_COMMAND',
    '<<<<<<< GET_TOOL_INFO',
  ];

  const isLegacy = legacyPatterns.some((p) => trimmed.includes(p));
  if (isLegacy) {
    return parseLegacyFormat(trimmed, workspaceFolders);
  }

  if (trimmed.includes('operation:') || trimmed.startsWith('---')) {
    return parseYamlFormat(trimmed, workspaceFolders);
  }

  throw new BrudError(parseError());
}

export function parseOperationsWithMetadata(
  input: string,
  workspaceFolders: string[] = [],
): {
  operations: FileOperation[];
  sessionMetadata?: SessionMetadata;
} {
  const { cleanedInput, sessionMetadata, operationMetadata } = extractMetadata(input);

  const operations = parseOperations(cleanedInput, workspaceFolders);

  for (const op of operations) {
    const meta = operationMetadata.get(op.index);
    if (meta) {
      (op as any).title = meta.title;
      (op as any).description = meta.description;
    }
  }

  return {
    operations,
    sessionMetadata,
  };
}

export function parseBlocks(input: string): PatchBlock[] {
  const operations = parseOperations(input);
  return operations
    .filter((op): op is FileOperation & { kind: 'search_replace' } => op.kind === 'search_replace')
    .map((op) => ({
      index: op.index,
      search: op.search,
      searchMeat: op.search.replace(/\s+/g, ''),
      replace: op.replace,
    }));
}