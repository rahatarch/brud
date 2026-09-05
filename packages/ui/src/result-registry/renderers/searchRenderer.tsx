import { FileText } from 'lucide-react';
import { ToolResultRenderer } from '../types';

interface SearchFileItem {
  path: string;
  name: string;
  extension: string;
  directory: string;
  size: number;
}

interface SearchFilesResult {
  results: SearchFileItem[];
  totalMatches: number;
  truncated: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const searchRenderer: ToolResultRenderer = {
  toolKind: 'search_files',
  title: 'Search Results',
  renderSection: (data: any) => {
    const searchData = data as SearchFilesResult;
    if (!searchData || !searchData.results) return null;
    return (
      <div>
        <div className="px-6 py-3 border-b border-border bg-surface-2 text-sm text-text-secondary">
          {searchData.truncated
            ? `Found ${searchData.totalMatches} files, showing first ${searchData.results.length}`
            : `Found ${searchData.totalMatches} files`}
        </div>
        <div className="divide-y divide-border">
          {searchData.results.map((file, index) => (
            <div key={index} className="flex items-center gap-3 px-6 py-3 hover:bg-surface-2 transition-colors">
              <FileText size={14} className="text-text-tertiary shrink-0" />
              <span className="text-xs text-text font-mono flex-1 truncate">{file.path}</span>
              <span className="text-xs text-text-secondary tabular-nums shrink-0">{formatSize(file.size)}</span>
              {file.extension && (
                <span className="text-xs text-text-tertiary bg-surface-2 border border-border rounded px-1.5 py-0.5 font-mono shrink-0">
                  {file.extension}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  },
  copyFormatter: (data: any) => {
    const searchData = data as SearchFilesResult;
    if (!searchData || !searchData.results) return '';
    return searchData.results.map(r => r.path).join('\n');
  },
};