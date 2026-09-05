import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, Play, X, FileText, Check } from 'lucide-react';
import { sendToExtension } from '../bridge/vscodeBridge';

interface DiffFileEntry {
  filePath: string;
  originalContent: string;
  modifiedContent: string;
  languageId?: string;
}

interface DiffPreviewData {
  files: DiffFileEntry[];
  currentIndex: number;
}

function computeLineDiff(original: string, modified: string): { type: 'same' | 'added' | 'removed'; text: string }[] {
  const origLines = original.split('\n');
  const modLines = modified.split('\n');
  const result: { type: 'same' | 'added' | 'removed'; text: string }[] = [];

  const maxLen = Math.max(origLines.length, modLines.length);
  for (let i = 0; i < maxLen; i++) {
    const origLine = i < origLines.length ? origLines[i] : null;
    const modLine = i < modLines.length ? modLines[i] : null;

    if (origLine === null && modLine !== null) {
      result.push({ type: 'added', text: modLine });
    } else if (origLine !== null && modLine === null) {
      result.push({ type: 'removed', text: origLine });
    } else if (origLine === modLine) {
      result.push({ type: 'same', text: origLine! });
    } else {
      result.push({ type: 'removed', text: origLine! });
      result.push({ type: 'added', text: modLine! });
    }
  }

  return result;
}

function getLanguageClass(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescriptreact',
    js: 'javascript',
    jsx: 'javascriptreact',
    json: 'json',
    css: 'css',
    html: 'html',
    md: 'markdown',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    h: 'c',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    sh: 'shellscript',
    bash: 'shellscript',
    sql: 'sql',
    vue: 'vue',
    svelte: 'svelte',
    scss: 'scss',
    less: 'less',
  };
  return langMap[ext] || 'plaintext';
}

function DiffPreviewPanel() {
  const [diffData, setDiffData] = useState<DiffPreviewData | null>(null);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [patchedFileIndices, setPatchedFileIndices] = useState<Set<number>>(new Set());
  const diffContentRef = useRef<HTMLDivElement>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    sendToExtension({ command: 'ready' });
  }, []);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const message = event.data;
      if (message.command === 'diffPreviewResult' && message.diffPreviewData) {
        setDiffData(message.diffPreviewData);
        setCurrentFileIndex(message.diffPreviewData.currentIndex || 0);
        setSuccessMessage(null);
        setPatchedFileIndices(new Set());
      }
      if (message.command === 'filePatched' && typeof message.fileIndex === 'number') {
        setPatchedFileIndices(prev => {
          const next = new Set(prev);
          next.add(message.fileIndex);
          return next;
        });
      }
      if (message.command === 'executeSuccess' && message.message) {
        if (diffData) {
          const allIndices = new Set(Array.from({ length: diffData.files.length }, (_, i) => i));
          setPatchedFileIndices(allIndices);
        }
        setSuccessMessage(message.message);
        if (successTimerRef.current) {
          clearTimeout(successTimerRef.current);
        }
        successTimerRef.current = setTimeout(() => {
          sendToExtension({ command: 'closeDiffPreview' });
        }, 3000);
      }
    }

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      if (successTimerRef.current) {
        clearTimeout(successTimerRef.current);
      }
    };
  }, [diffData]);

  const currentFile = diffData?.files[currentFileIndex];

  const handlePrevFile = useCallback(() => {
    if (!diffData) return;
    const idx = currentFileIndex > 0 ? currentFileIndex - 1 : diffData.files.length - 1;
    setCurrentFileIndex(idx);
  }, [diffData, currentFileIndex]);

  const handleNextFile = useCallback(() => {
    if (!diffData) return;
    const idx = currentFileIndex < diffData.files.length - 1 ? currentFileIndex + 1 : 0;
    setCurrentFileIndex(idx);
  }, [diffData, currentFileIndex]);

  const handleExecuteCurrent = useCallback(() => {
    sendToExtension({ command: 'executeCurrentFile' });
  }, []);

  const handleExecuteAll = useCallback(() => {
    sendToExtension({ command: 'executeAllFiles' });
  }, []);

  const handleReject = useCallback(() => {
    sendToExtension({ command: 'rejectPreview' });
  }, []);

  const handleDone = useCallback(() => {
    sendToExtension({ command: 'doneDiffPreview' });
  }, []);

  const handleTabClick = useCallback((index: number) => {
    setCurrentFileIndex(index);
  }, []);

  const allPatched = diffData ? patchedFileIndices.size === diffData.files.length : false;

  if (!diffData || diffData.files.length === 0) {
    if (successMessage) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-surface px-6 py-12">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
          <h2 className="text-xl font-semibold text-text mb-2">All Patches Applied</h2>
          <p className="text-sm text-text-secondary text-center max-w-md leading-relaxed">
            {successMessage}
          </p>
          <p className="text-xs text-text-tertiary mt-4">Closing automatically...</p>
        </div>
      );
    }
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-surface px-6 py-12">
        <h1 className="text-2xl font-semibold text-text mb-3">Brud Diff Preview</h1>
        <p className="text-sm text-text-secondary text-center max-w-md leading-relaxed">
          Preview file diffs before applying changes. Use the Preview button to generate a diff preview.
        </p>
      </div>
    );
  }

  if (successMessage) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-surface px-6 py-12">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>
        <h2 className="text-xl font-semibold text-text mb-2">All Patches Applied</h2>
        <p className="text-sm text-text-secondary text-center max-w-md leading-relaxed">
          {successMessage}
        </p>
        <p className="text-xs text-text-tertiary mt-4">Closing automatically...</p>
      </div>
    );
  }

  const diffLines = currentFile
    ? computeLineDiff(currentFile.originalContent, currentFile.modifiedContent)
    : [];

  return (
    <div className="min-h-screen flex flex-col bg-surface">
      <div className="border-b border-border bg-surface-2 px-4 py-3 flex items-center justify-between shrink-0">
        <h1 className="text-lg font-semibold text-text">Brud Diff Preview</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExecuteAll}
            disabled={allPatched}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
              allPatched
                ? 'bg-surface-1 text-text-tertiary cursor-not-allowed'
                : 'bg-primary hover:bg-primary-hover text-white'
            }`}
          >
            <Play size={12} />
            Execute All
          </button>
          <button
            onClick={handleDone}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-border bg-surface hover:bg-surface-2 text-text-secondary hover:text-text transition-colors cursor-pointer"
          >
            <Check size={12} />
            Done
          </button>
          <button
            onClick={handleReject}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-border bg-surface hover:bg-surface-2 text-text-secondary hover:text-text transition-colors cursor-pointer"
          >
            <X size={12} />
            Reject
          </button>
        </div>
      </div>

      <div className="border-b border-border bg-surface-2 flex items-center overflow-x-auto">
        {diffData.files.map((file, index) => {
          const isPatched = patchedFileIndices.has(index);
          return (
            <button
              key={index}
              onClick={() => handleTabClick(index)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors cursor-pointer shrink-0 ${
                index === currentFileIndex
                  ? 'border-primary text-text bg-surface'
                  : 'border-transparent text-text-secondary hover:text-text hover:bg-surface-1'
              }`}
            >
              <FileText size={12} />
              {file.filePath.split('/').pop() || file.filePath}
              {isPatched && (
                <span className="ml-1 text-green-400">
                  <Check size={10} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="border-b border-border bg-surface-2 px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrevFile}
            className="flex items-center justify-center w-7 h-7 rounded hover:bg-surface-1 text-text-secondary hover:text-text transition-colors cursor-pointer"
            title="Previous file"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs text-text-secondary font-medium">
            {currentFileIndex + 1} / {diffData.files.length}
          </span>
          <button
            onClick={handleNextFile}
            className="flex items-center justify-center w-7 h-7 rounded hover:bg-surface-1 text-text-secondary hover:text-text transition-colors cursor-pointer"
            title="Next file"
          >
            <ChevronRight size={14} />
          </button>
        </div>
        <div className="flex items-center gap-3 ml-4 flex-1 min-w-0">
          <span className="text-xs text-text-secondary font-mono truncate">
            {currentFile?.filePath || ''}
          </span>
          <span className={`text-xs font-medium shrink-0 ${patchedFileIndices.has(currentFileIndex) ? 'text-green-400' : 'text-yellow-400'}`}>
            {patchedFileIndices.has(currentFileIndex) ? 'Patched' : 'Pending'}
          </span>
          {!patchedFileIndices.has(currentFileIndex) && (
            <button
              onClick={handleExecuteCurrent}
              className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-primary hover:bg-primary-hover text-white transition-colors cursor-pointer shrink-0"
            >
              <Play size={10} />
              Execute This File
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex">
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-y-auto border-r border-border" ref={diffContentRef}>
            <div className="text-xs font-mono leading-relaxed">
              {diffLines.map((line, i) => (
                <div
                  key={i}
                  className={`flex px-4 py-0.5 ${
                    line.type === 'added'
                      ? 'bg-green-900/20 text-green-300'
                      : line.type === 'removed'
                      ? 'bg-red-900/20 text-red-300'
                      : 'text-text-secondary'
                  }`}
                >
                  <span className="w-8 text-right text-text-tertiary select-none shrink-0 mr-4">
                    {i + 1}
                  </span>
                  <span className="w-4 shrink-0 select-none">
                    {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                  </span>
                  <span className="whitespace-pre-wrap break-all flex-1">{line.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DiffPreviewPanel;