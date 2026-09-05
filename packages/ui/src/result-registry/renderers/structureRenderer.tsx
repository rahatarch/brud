import { FileText } from 'lucide-react';
import { ToolResultRenderer } from '../types';

interface StructureData {
  json: string;
  directoryPath: string;
  depth: number;
  fileCount: number;
  directoryCount: number;
}

function formatStructureData(data: any): StructureData[] {
  if (Array.isArray(data)) return data;
  if (data && data.json) return [data];
  return [];
}

export const structureRenderer: ToolResultRenderer = {
  toolKind: 'extractionResults',
  title: 'Structure Extraction',
  renderSection: (data: any) => {
    const structures = formatStructureData(data);
    if (structures.length === 0) return null;
    return (
      <div>
        {structures.map((s, index) => (
          <div key={index}>
            <div className="flex items-center gap-6 px-6 py-3 border-b border-border bg-surface-2 text-sm text-text-secondary">
              <span className="text-xs text-text-tertiary font-medium mr-1">#{index + 1}</span>
              <span>
                Path: <span className="text-text font-mono">{s.directoryPath}</span>
              </span>
              <span>
                Depth: <span className="text-text">{s.depth === 0 ? 'unlimited' : s.depth}</span>
              </span>
              <span>
                Files: <span className="text-text">{s.fileCount}</span>
              </span>
              <span>
                Dirs: <span className="text-text">{s.directoryCount}</span>
              </span>
            </div>
            <div className="p-6 border-b border-border">
              <pre className="text-xs text-text-secondary font-mono whitespace-pre leading-relaxed">
                {s.json}
              </pre>
            </div>
          </div>
        ))}
      </div>
    );
  },
  copyFormatter: (data: any) => {
    const structures = formatStructureData(data);
    return structures.map(s => {
      const summary = `Path: ${s.directoryPath} | Depth: ${s.depth === 0 ? 'unlimited' : s.depth} | Files: ${s.fileCount} | Dirs: ${s.directoryCount}`;
      let compactJson = s.json;
      try {
        compactJson = JSON.stringify(JSON.parse(s.json));
      } catch {}
      return `${summary}\n${compactJson}`;
    }).join('\n\n');
  },
};