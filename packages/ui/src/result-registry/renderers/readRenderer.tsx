import { useState, useCallback } from 'react';
import { Copy, Check, FileText, ChevronDown, ChevronRight } from 'lucide-react';
import { ToolResultRenderer } from '../types';

interface ReadFileEntry {
  path: string;
  content: string;
  size: number;
  isImported?: boolean;
  importedFrom?: string;
}

interface ReadResultData {
  files: ReadFileEntry[];
  totalFiles: number;
  totalSize: number;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const formatted = (bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1);
  return formatted + ' ' + sizes[i];
}

function ReadFileList({ data }: { data: ReadResultData }) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [copiedFile, setCopiedFile] = useState<string | null>(null);

  const toggleFile = useCallback((filePath: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  }, []);

  const handleCopyFile = useCallback((file: ReadFileEntry) => {
    const text = `File: ${file.path}\nSize: ${formatSize(file.size)}\n---\n${file.content}`;
    navigator.clipboard.writeText(text);
    setCopiedFile(file.path);
    setTimeout(() => setCopiedFile(null), 2000);
  }, []);

  return (
    <div className="divide-y divide-border">
      {(data.files || []).map((file, index) => (
        <div key={index}>
          <div
            className="flex items-center gap-3 px-6 py-3 hover:bg-surface-2 transition-colors cursor-pointer"
            onClick={() => toggleFile(file.path)}
          >
            <button className="text-text-tertiary shrink-0">
              {expandedFiles.has(file.path) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            <FileText size={14} className="text-text-tertiary shrink-0" />
            <span className="text-xs text-text font-mono flex-1 truncate">{file.path}</span>
            <span className="text-xs text-text-secondary tabular-nums shrink-0">{formatSize(file.size)}</span>
            {file.isImported && (
              <span className="text-xs text-text-tertiary bg-surface-2 border border-border rounded px-1.5 py-0.5 font-mono shrink-0">
                imported
              </span>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); handleCopyFile(file); }}
              className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded border border-border bg-surface hover:bg-surface-2 text-text-secondary hover:text-text transition-colors cursor-pointer shrink-0"
            >
              {copiedFile === file.path ? <Check size={12} /> : <Copy size={12} />}
              {copiedFile === file.path ? 'Copied!' : 'Copy'}
            </button>
          </div>
          {expandedFiles.has(file.path) && (
            <div className="px-6 pb-3">
              <pre className="text-xs text-text-secondary font-mono whitespace-pre leading-relaxed bg-surface-2 border border-border rounded p-4 overflow-x-auto max-h-150 overflow-y-auto">
                {file.content}
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export const readRenderer: ToolResultRenderer = {
  toolKind: 'readResults',
  title: 'File Reading',
  renderSection: (data: any) => {
    const readData = data as ReadResultData;
    if (!readData || !readData.files || readData.files.length === 0) return null;
    return (
      <div>
        <div className="px-6 py-2 border-b border-border bg-surface-2 text-xs text-text-secondary">
          {readData.totalFiles} files ({formatSize(readData.totalSize || 0)})
        </div>
        <ReadFileList data={readData} />
      </div>
    );
  },
  copyFormatter: (data: any) => {
    const readData = data as ReadResultData;
    if (!readData || !readData.files) return '';
    return readData.files.map(f => {
      return `File: ${f.path}\nSize: ${formatSize(f.size)}\n---\n${f.content}`;
    }).join('\n\n');
  },
};