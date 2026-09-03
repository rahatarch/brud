import * as yaml from 'js-yaml';
import { FileOperation } from '../types/patch';

export function parseYamlFormat(input: string): FileOperation[] {
  const operations: FileOperation[] = [];
  const docs = input.split(/(?:^|\n)---\s*\n/);

  for (const doc of docs) {
    const trimmed = doc.trim();
    if (!trimmed) {
      continue;
    }

    const parsed = yaml.load(trimmed) as Record<string, unknown> | undefined;

    if (!parsed || typeof parsed !== 'object') {
      continue;
    }

    const operation = parsed.operation as string | undefined;
    if (!operation) {
      throw new Error('Missing operation field in YAML document');
    }

    const index = parsed.index as string | undefined;
    if (index === undefined || index === null) {
      throw new Error('Missing index field in YAML document');
    }

    switch (operation) {
      case 'replace': {
        const path = parsed.path as string | undefined;
        const search = parsed.search as string | undefined;
        const replace = parsed.replace as string | undefined;
        if (!path) {
          throw new Error('Missing path field in replace operation');
        }
        if (search === undefined || search === null) {
          throw new Error('Missing search field in replace operation');
        }
        if (replace === undefined || replace === null) {
          throw new Error('Missing replace field in replace operation');
        }
        operations.push({
          kind: 'search_replace',
          path,
          index: String(index),
          search,
          replace,
        });
        break;
      }
      case 'create_file': {
        const path = parsed.path as string | undefined;
        const content = parsed.content as string | undefined;
        if (!path) {
          throw new Error('Missing path field in create_file operation');
        }
        if (content === undefined || content === null) {
          throw new Error('Missing content field in create_file operation');
        }
        operations.push({
          kind: 'create_file',
          path,
          index: String(index),
          content,
        });
        break;
      }
      case 'delete_file': {
        const path = parsed.path as string | undefined;
        if (!path) {
          throw new Error('Missing path field in delete_file operation');
        }
        operations.push({
          kind: 'delete_file',
          path,
          index: String(index),
        });
        break;
      }
      case 'rename_file': {
        const from = parsed.from as string | undefined;
        const to = parsed.to as string | undefined;
        if (!from) {
          throw new Error('Missing from field in rename_file operation');
        }
        if (!to) {
          throw new Error('Missing to field in rename_file operation');
        }
        operations.push({
          kind: 'rename_file',
          from,
          to,
          index: String(index),
        });
        break;
      }
      case 'move_file': {
        const from = parsed.from as string | undefined;
        const to = parsed.to as string | undefined;
        if (!from) {
          throw new Error('Missing from field in move_file operation');
        }
        if (!to) {
          throw new Error('Missing to field in move_file operation');
        }
        operations.push({
          kind: 'move_file',
          from,
          to,
          index: String(index),
        });
        break;
      }
      case 'copy_file': {
        const from = parsed.from as string | undefined;
        const to = parsed.to as string | undefined;
        if (!from) {
          throw new Error('Missing from field in copy_file operation');
        }
        if (!to) {
          throw new Error('Missing to field in copy_file operation');
        }
        operations.push({
          kind: 'copy_file',
          from,
          to,
          index: String(index),
        });
        break;
      }
      case 'append_file': {
        const path = parsed.path as string | undefined;
        const content = parsed.content as string | undefined;
        if (!path) {
          throw new Error('Missing path field in append_file operation');
        }
        if (content === undefined || content === null) {
          throw new Error('Missing content field in append_file operation');
        }
        const position = parsed.position as string | undefined;
        if (position !== undefined && position !== 'start' && position !== 'end') {
          throw new Error('Position field must be "start" or "end" in append_file operation');
        }
        operations.push({
          kind: 'append_file',
          path,
          position: (position as 'start' | 'end') || 'end',
          index: String(index),
          content,
        });
        break;
      }
      case 'create_directory': {
        const directoryPath = parsed.directoryPath as string | undefined;
        const files = parsed.files as string[] | undefined;
        if (!directoryPath) {
          throw new Error('Missing directoryPath field in create_directory operation');
        }
        operations.push({
          kind: 'create_directory',
          directoryPath,
          files: files || [],
          index: String(index),
        });
        break;
      }
      case 'delete_directory': {
        const directoryPath = parsed.directoryPath as string | undefined;
        if (!directoryPath) {
          throw new Error('Missing directoryPath field in delete_directory operation');
        }
        operations.push({
          kind: 'delete_directory',
          directoryPath,
          index: String(index),
        });
        break;
      }
      case 'move_directory': {
        const from = parsed.from as string | undefined;
        const to = parsed.to as string | undefined;
        if (!from) {
          throw new Error('Missing from field in move_directory operation');
        }
        if (!to) {
          throw new Error('Missing to field in move_directory operation');
        }
        operations.push({
          kind: 'move_directory',
          from,
          to,
          index: String(index),
        });
        break;
      }
      case 'codebase_metadata': {
        operations.push({
          kind: 'codebase_metadata',
          index: String(index),
        });
        break;
      }
      case 'extract_structure': {
        const directoryPath = parsed.directoryPath as string | undefined;
        const depth = parsed.depth as number | undefined;
        if (!directoryPath) {
          throw new Error('Missing directoryPath field in extract_structure operation');
        }
        operations.push({
          kind: 'extract_structure',
          directoryPath,
          depth: depth ?? 0,
          index: String(index),
        });
        break;
      }
      default:
        throw new Error(`Unrecognized operation type: ${operation}`);
    }
  }

  return operations;
}