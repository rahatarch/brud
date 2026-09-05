import { ToolResultRenderer } from '../types';

interface CodebaseMetadataResult {
  root: string;
  totalFiles: number;
  totalFolders: number;
  mostDenseFolder: string;
  mostDenseCount: number;
}

export const metadataRenderer: ToolResultRenderer = {
  toolKind: 'codebase_metadata',
  title: 'Codebase Metadata',
  renderSection: (data: any) => {
    const metadata = data as CodebaseMetadataResult;
    if (!metadata || metadata.root === undefined) return null;
    return (
      <div>
        <div className="flex items-center gap-6 px-6 py-3 border-b border-border bg-surface-2 text-sm text-text-secondary">
          <span>
            Root: <span className="text-text font-mono">{metadata.root}</span>
          </span>
          <span>
            Files: <span className="text-text">{metadata.totalFiles}</span>
          </span>
          <span>
            Folders: <span className="text-text">{metadata.totalFolders}</span>
          </span>
        </div>
        <div className="p-6 border-b border-border">
          <div className="mb-2 text-sm text-text-secondary">Most Dense Folder</div>
          <div className="text-xs text-text font-mono">{metadata.mostDenseFolder}</div>
          <div className="text-xs text-text-secondary mt-1">{metadata.mostDenseCount} files</div>
        </div>
        <div className="p-6 border-b border-border">
          <div className="mb-2 text-sm text-text-secondary">JSON</div>
          <pre className="text-xs text-text-secondary font-mono whitespace-pre leading-relaxed">
            {JSON.stringify(metadata, null, 2)}
          </pre>
        </div>
      </div>
    );
  },
  copyFormatter: (data: any) => {
    return JSON.stringify(data);
  },
};