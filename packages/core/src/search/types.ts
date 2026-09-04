export interface FileSearchQuery {
  patterns: string[];
  extensions?: string[];
  excludePatterns?: string[];
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