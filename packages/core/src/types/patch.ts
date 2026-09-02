export interface PatchBlock {
  index: string;
  search: string;
  searchMeat: string;
  replace: string;
}

export interface MatchResult {
  startLine: number;
  endLine: number;
  replace: string;
  index: string;
}

export type FileOperationKind = 'search_replace' | 'create_file' | 'delete_file' | 'rename_file' | 'move_file' | 'copy_file' | 'append_file' | 'create_directory' | 'delete_directory' | 'move_directory';

export interface SearchReplaceOperation {
  kind: 'search_replace';
  path: string;
  index: string;
  search: string;
  replace: string;
}

export interface CreateFileOperation {
  kind: 'create_file';
  path: string;
  index: string;
  content: string;
}

export interface DeleteFileOperation {
  kind: 'delete_file';
  path: string;
  index: string;
}

export interface RenameFileOperation {
  kind: 'rename_file';
  from: string;
  to: string;
  index: string;
}

export interface MoveFileOperation {
  kind: 'move_file';
  from: string;
  to: string;
  index: string;
}

export interface CopyFileOperation {
  kind: 'copy_file';
  from: string;
  to: string;
  index: string;
}

export interface AppendFileOperation {
  kind: 'append_file';
  path: string;
  position: 'start' | 'end';
  index: string;
  content: string;
}

export interface CreateDirectoryOperation {
  kind: 'create_directory';
  directoryPath: string;
  files: string[];
  index: string;
}

export interface DeleteDirectoryOperation {
  kind: 'delete_directory';
  directoryPath: string;
  index: string;
}

export interface MoveDirectoryOperation {
  kind: 'move_directory';
  from: string;
  to: string;
  index: string;
}

export type FileOperation = SearchReplaceOperation | CreateFileOperation | DeleteFileOperation | RenameFileOperation | MoveFileOperation | CopyFileOperation | AppendFileOperation | CreateDirectoryOperation | DeleteDirectoryOperation | MoveDirectoryOperation;