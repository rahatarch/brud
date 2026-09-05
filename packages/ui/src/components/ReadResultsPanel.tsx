import { useState, useEffect, useCallback } from 'react';
import { Copy, Check, FileText, ChevronDown, ChevronRight } from 'lucide-react';
import CustomScrollbar from './CustomScrollbar';
import { sendToExtension } from '../bridge/vscodeBridge';

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

function ReadResultsPanel() {
  const [readResult, setReadResult] = useState<ReadResultData | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [copiedFile, setCopiedFile] = useState<string | null>(null);

  useEffect(() => {
    sendToExtension({ command: 'ready' });
  }, []);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const message = event.data;
      if (message.command === 'readResult' && message.readResult) {
        setReadResult(message.readResult);
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const toggleFile = useCallback((filePath: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }, []);

  const handleCopyFile = useCallback((file: ReadFileEntry) => {
    const text = `File: ${file.path}\nSize: ${formatSize(file.size)}\n---\n${file.content}`;
    navigator.clipboard.writeText(text);
    setCopiedFile(file.path);
    setTimeout(() => setCopiedFile(null), 2000);
  }, []);

  const handleCopyAll = useCallback(() => {
    if (!readResult || !readResult.files) return;
    const text = readResult.files.map(f => {
      return `File: ${f.path}\nSize: ${formatSize(f.size)}\n---\n${f.content}`;
    }).join('\n\n');
    navigator.clipboard.writeText(text);
    setCopiedFile('__all__');
    setTimeout(() => setCopiedFile(null), 2000);
  }, [readResult]);

  if (!readResult || !readResult.files || readResult.files.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-surface px-6 py-12">
        <h1 className="text-2xl font-semibold text-text mb-3">Read Result</h1>
        <p className="text-sm text-text-secondary text-center max-w-md leading-relaxed">
          {!readResult
            ? 'Use a read_file, read_files, or read_directory operation to populate this view.'
            : 'No files read.'}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-surface">
      <div className="border-b border-border bg-surface-2 px-6 py-4 flex items-center justify-between shrink-0">
        <h1 className="text-xl font-semibold text-text">
          Read Result
        </h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-secondary">
            {readResult.totalFiles || 0} files ({formatSize(readResult.totalSize || 0)})
          </span>
          <button
            onClick={handleCopyAll}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-border bg-surface hover:bg-surface-2 text-text-secondary hover:text-text transition-colors cursor-pointer"
          >
            {copiedFile === '__all__' ? <Check size={14} /> : <Copy size={14} />}
            {copiedFile === '__all__' ? 'Copied!' : 'Copy All'}
          </button>
        </div>
      </div>

      <CustomScrollbar className="flex-1">
        <div className="divide-y divide-border">
          {(readResult.files || []).map((file, index) => (
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
                  <pre className="text-xs text-text-secondary font-mono whitespace-pre leading-relaxed bg-surface-2 border border-border rounded p-4 overflow-x-auto max-h-[600px] overflow-y-auto">
                    {file.content}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      </CustomScrollbar>
    </div>
  );
}

export default ReadResultsPanel;