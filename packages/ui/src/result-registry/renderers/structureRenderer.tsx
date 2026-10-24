import { FileText } from 'lucide-react';
import { isStructurePayload } from '../types';
import type { ToolResultRenderer } from '../types';

export const structureRenderer: ToolResultRenderer = {
  toolKind: 'extractionResults',
  title: 'Structure Extraction',
  canRender: (data: unknown) => isStructurePayload(data),
  renderSection: (data: unknown) => {
    if (!isStructurePayload(data) || !data.json) return null;
    return (
      <div>
        <div className="flex items-center gap-6 px-6 py-3 border-b border-border bg-surface-2 text-sm text-text-secondary">
          <span className="text-xs text-text-tertiary font-medium mr-1">#1</span>
          <span>
            Path: <span className="text-text font-mono">{data.directoryPath}</span>
          </span>
          <span>
            Depth: <span className="text-text">{data.depth === 0 ? 'unlimited' : data.depth}</span>
          </span>
          <span>
            Files: <span className="text-text">{data.fileCount}</span>
          </span>
          <span>
            Dirs: <span className="text-text">{data.directoryCount}</span>
          </span>
        </div>
        <div className="p-6 border-b border-border">
          <pre className="text-xs text-text-secondary font-mono whitespace-pre leading-relaxed">
            {data.json}
          </pre>
        </div>
      </div>
    );
  },
  copyFormatter: (data: unknown) => {
    if (!isStructurePayload(data) || !data.json) return '';
    const summary = `Path: ${data.directoryPath} | Depth: ${data.depth === 0 ? 'unlimited' : data.depth} | Files: ${data.fileCount} | Dirs: ${data.directoryCount}`;
    let compactJson = data.json;
    try {
      compactJson = JSON.stringify(JSON.parse(data.json));
    } catch {
      compactJson = data.json;
    }
    return `${summary}\n${compactJson}`;
  },
  summaryFormatter: (data: unknown) => {
    if (!isStructurePayload(data)) return '';
    return `[success] Extract Structure: ${data.fileCount} files, ${data.directoryCount} dirs`;
  },
};