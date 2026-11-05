export interface FileSearchQuery {
  patterns: string[];
  extensions?: string[];
  excludePatterns?: string[];
  /** Workspace-relative directory; `undefined` or `''` means the root. */
  directory?: string;
  recursive: boolean;
  maxResults?: number;
}

export interface FileSearchResult {
  path: string;
  name: string;
  extension: string;
  directory: string;
  size: number;
}

export interface FileSearchResponse {
  results: FileSearchResult[];
  totalMatches: number;
  truncated: boolean;
}

/** Raised when a search query is missing required input. */
export class FileSearchQueryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'FileSearchQueryError';
    this.code = code;
  }
}