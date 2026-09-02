import { PatchBlock, FileOperation } from '../types/patch';
import { parseLegacyFormat } from './parsers/legacy';
import { parseYamlFormat } from './parsers/yaml';

export function parseOperations(input: string): FileOperation[] {
  const trimmed = input.trim();

  const legacyPatterns = [
    '<<<<<<< SEARCH',
    '<<<<<<< CREATE_FILE',
    '<<<<<<< DELETE_FILE',
    '<<<<<<< RENAME_FILE',
    '<<<<<<< MOVE_FILE',
    '<<<<<<< COPY_FILE',
  ];

  const isLegacy = legacyPatterns.some((p) => trimmed.includes(p));
  if (isLegacy) {
    return parseLegacyFormat(trimmed);
  }

  if (trimmed.includes('operation:') || trimmed.startsWith('---')) {
    return parseYamlFormat(trimmed);
  }

  throw new Error('Unrecognized patch format. Please use either the legacy Brud format or YAML format.');
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