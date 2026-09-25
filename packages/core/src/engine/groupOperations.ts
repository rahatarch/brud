import type { FileOperation } from '../types/patch';

export function groupOperationsByFile(operations: FileOperation[]): Map<string, FileOperation[]> {
  const grouped = new Map<string, FileOperation[]>();
  for (const op of operations) {
    const key = op.kind === 'rename_file' || op.kind === 'move_file' || op.kind === 'copy_file'
      ? op.from
      : op.kind === 'create_directory'
      ? op.directoryPath
      : op.kind === 'delete_directory'
      ? op.directoryPath
      : op.kind === 'move_directory'
      ? op.from
      : op.kind === 'extract_structure'
      ? op.directoryPath
      : op.kind === 'codebase_metadata'
      ? '__codebase_metadata__'
      : op.kind === 'search_files'
      ? '__search_files__'
      : op.kind === 'append_file_multi'
      ? '__append_file_multi__'
      : op.kind === 'search_replace_multi'
      ? '__search_replace_multi__'
      : op.kind === 'read_file'
      ? op.path
      : op.kind === 'read_files'
      ? '__read_files__'
      : op.kind === 'read_directory'
      ? op.directoryPath
      : op.kind === 'terminal_interactive'
      ? '__terminal_interactive__'
      : (op as any).path;
    const existing = grouped.get(key) || [];
    existing.push(op);
    grouped.set(key, existing);
  }
  return grouped;
}