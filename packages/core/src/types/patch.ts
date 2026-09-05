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

export type FileOperationKind = 'search_replace' | 'create_file' | 'delete_file' | 'rename_file' | 'move_file' | 'copy_file' | 'append_file' | 'append_file_multi' | 'search_replace_multi' | 'create_directory' | 'delete_directory' | 'move_directory' | 'extract_structure' | 'codebase_metadata' | 'search_files' | 'read_file' | 'read_files' | 'read_directory' | 'terminal_interactive';

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

export interface ExtractStructureOperation {
  kind: 'extract_structure';
  directoryPath: string;
  depth: number;
  index: string;
}

export interface CodebaseMetadataOperation {
  kind: 'codebase_metadata';
  index: string;
}

export interface SearchFilesOperation {
  kind: 'search_files';
  patterns: string[];
  extensions?: string[];
  excludePatterns?: string[];
  directory?: string;
  recursive: boolean;
  maxResults: number;
  index: string;
}

export interface AppendFileMultiOperation {
  kind: 'append_file_multi';
  patterns: string[];
  excludePatterns?: string[];
  directory?: string;
  recursive: boolean;
  maxResults: number;
  position: 'start' | 'end';
  content: string;
  index: string;
}

export interface SearchReplaceMultiOperation {
  kind: 'search_replace_multi';
  patterns: string[];
  excludePatterns?: string[];
  directory?: string;
  recursive: boolean;
  maxResults: number;
  search: string;
  replace: string;
  index: string;
}

export interface ReadFileOperation {
  kind: 'read_file';
  path: string;
  isImportRead: boolean;
  maxDepth: number;
  excludePatterns?: string[];
  importSyntax?: string[];
  index: string;
}

export interface ReadFilesOperation {
  kind: 'read_files';
  patterns: string[];
  excludePatterns?: string[];
  directory?: string;
  recursive: boolean;
  maxResults: number;
  isImportRead: boolean;
  maxDepth: number;
  importSyntax?: string[];
  index: string;
}

export interface ReadDirectoryOperation {
  kind: 'read_directory';
  directoryPath: string;
  recursive: boolean;
  excludePatterns?: string[];
  isImportRead: boolean;
  maxDepth: number;
  importSyntax?: string[];
  index: string;
}

export interface TerminalInteractiveOperation {
  kind: 'terminal_interactive';
  command: string;
  answers: string[];
  timeout?: number;
  cwd?: string;
  index: string;
}

export type FileOperation = SearchReplaceOperation | CreateFileOperation | DeleteFileOperation | RenameFileOperation | MoveFileOperation | CopyFileOperation | AppendFileOperation | AppendFileMultiOperation | SearchReplaceMultiOperation | CreateDirectoryOperation | DeleteDirectoryOperation | MoveDirectoryOperation | ExtractStructureOperation | CodebaseMetadataOperation | SearchFilesOperation | ReadFileOperation | ReadFilesOperation | ReadDirectoryOperation | TerminalInteractiveOperation;