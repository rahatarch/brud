import { isCodebaseMetadataPayload } from '../types';
import type { ToolResultRenderer } from '../types';

export const metadataRenderer: ToolResultRenderer = {
  toolKind: 'codebase_metadata',
  title: 'Codebase Metadata',
  canRender: (data: unknown) => isCodebaseMetadataPayload(data),
  renderSection: (data: unknown) => {
    if (!isCodebaseMetadataPayload(data)) return null;
    return (
      <div>
        <div className="flex items-center gap-6 px-6 py-3 border-b border-border bg-surface-2 text-sm text-text-secondary">
          <span>
            Root: <span className="text-text font-mono">{data.root}</span>
          </span>
          <span>
            Files: <span className="text-text">{data.totalFiles}</span>
          </span>
          <span>
            Folders: <span className="text-text">{data.totalFolders}</span>
          </span>
        </div>
        <div className="p-6 border-b border-border">
          <div className="mb-2 text-sm text-text-secondary">Most Dense Folder</div>
          <div className="text-xs text-text font-mono">{data.mostDenseFolder}</div>
          <div className="text-xs text-text-secondary mt-1">{data.mostDenseCount} files</div>
        </div>
        <div className="p-6 border-b border-border">
          <div className="mb-2 text-sm text-text-secondary">JSON</div>
          <pre className="text-xs text-text-secondary font-mono whitespace-pre leading-relaxed">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      </div>
    );
  },
  copyFormatter: (data: unknown) => {
    return JSON.stringify(data);
  },
  summaryFormatter: (data: unknown) => {
    if (!isCodebaseMetadataPayload(data)) return '';
    return `[success] Codebase Metadata: ${data.totalFiles} files in ${data.totalFolders} folders`;
  },
};