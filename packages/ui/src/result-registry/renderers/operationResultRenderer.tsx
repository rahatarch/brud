import { Check, X, AlertTriangle, ChevronRight, Copy, CheckIcon } from 'lucide-react';
import { useState } from 'react';
import { ToolResultRenderer } from '../types';

interface OperationResultData {
  operationId: string;
  operationIndex: number;
  kind: string;
  status: 'success' | 'aborted' | 'failed';
  message: string;
  path: string;
  from?: string;
  to?: string;
  directoryPath?: string;
  files?: string[];
  fileResults?: {
    modified: string[];
    skipped: string[];
    failed: string[];
  };
  data?: any;
}

const KIND_LABELS: Record<string, string> = {
  search_replace: 'Search & Replace',
  create_file: 'Create File',
  delete_file: 'Delete File',
  rename_file: 'Rename File',
  move_file: 'Move File',
  copy_file: 'Copy File',
  append_file: 'Append File',
  append_file_multi: 'Append File (Multi)',
  search_replace_multi: 'Search & Replace (Multi)',
  create_directory: 'Create Directory',
  delete_directory: 'Delete Directory',
  move_directory: 'Move Directory',
  terminal_interactive: 'Terminal (Interactive)',
};

function getKindLabel(kind: string): string {
  return KIND_LABELS[kind] || kind.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; bg: string; text: string; border: string }> = {
  success: {
    icon: <Check size={14} />,
    bg: 'bg-green-500/10',
    text: 'text-green-400',
    border: 'border-green-500/30',
  },
  failed: {
    icon: <X size={14} />,
    bg: 'bg-red-500/10',
    text: 'text-red-400',
    border: 'border-red-500/30',
  },
  aborted: {
    icon: <AlertTriangle size={14} />,
    bg: 'bg-yellow-500/10',
    text: 'text-yellow-400',
    border: 'border-yellow-500/30',
  },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.failed;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      {cfg.icon}
      {status}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 text-xs text-primary hover:text-primary-hover cursor-pointer bg-surface-2 border border-border-subtle rounded px-3 py-2 transition-colors w-full text-left"
    >
      {copied ? <><CheckIcon size={12} /> Copied!</> : <><Copy size={12} /> Copy</>}
    </button>
  );
}

export const operationResultRenderer: ToolResultRenderer = {
  toolKind: 'operation_result',
  title: 'Operation Result',
  renderSection: (data: any) => {
    const op = data as OperationResultData;
    if (!op || !op.kind) return null;

    const kindLabel = getKindLabel(op.kind);
    const statusCfg = STATUS_CONFIG[op.status] || STATUS_CONFIG.failed;
    const showPathFromTo = ['rename_file', 'move_file', 'copy_file'].includes(op.kind);
    const isDirectory = op.kind === 'create_directory';

    return (
      <div>
        <div className={`px-6 py-3 border-b border-border ${statusCfg.bg}`}>
          <div className="flex items-start gap-3">
            <span className={`shrink-0 mt-0.5 ${statusCfg.text}`}>{statusCfg.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-text">{kindLabel}</span>
                <StatusBadge status={op.status} />
              </div>
              {op.path && !showPathFromTo && (
                <div className="text-xs text-text-secondary mt-1 truncate font-mono">{op.path}</div>
              )}
              {showPathFromTo && op.from && (
                <div className="text-xs text-text-secondary mt-1 font-mono flex items-center gap-1">
                  <span className="truncate">{op.from}</span>
                  <ChevronRight size={12} className="shrink-0 text-text-tertiary" />
                  <span className="truncate">{op.to || ''}</span>
                </div>
              )}
              {isDirectory && op.directoryPath && (
                <div className="text-xs text-text-secondary mt-1 font-mono">
                  {op.directoryPath}
                  {op.files && op.files.length > 0 && (
                    <span className="ml-2 text-text-tertiary">({op.files.length} files)</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        {op.message && (
          <div className="px-6 py-3">
            <div className="text-sm text-text leading-relaxed">{op.message}</div>
          </div>
        )}
        {op.fileResults && (
          <div className="px-6 pb-2 space-y-1">
            {op.fileResults.modified.length > 0 && (
              <details className="group">
                <summary className="text-xs font-medium text-green-400 cursor-pointer list-none flex items-center gap-1 hover:text-green-300 select-none py-1">
                  <span className="opacity-60 group-open:opacity-100 transition-opacity">▶</span>
                  Modified ({op.fileResults.modified.length})
                </summary>
                <div className="mt-1 ml-3 space-y-0.5">
                  {op.fileResults.modified.map((f, i) => (
                    <div key={i} className="text-xs text-green-400/80 font-mono truncate">{f}</div>
                  ))}
                </div>
              </details>
            )}
            {op.fileResults.skipped.length > 0 && (
              <details className="group">
                <summary className="text-xs font-medium text-yellow-400 cursor-pointer list-none flex items-center gap-1 hover:text-yellow-300 select-none py-1">
                  <span className="opacity-60 group-open:opacity-100 transition-opacity">▶</span>
                  Skipped ({op.fileResults.skipped.length})
                </summary>
                <div className="mt-1 ml-3 space-y-0.5">
                  {op.fileResults.skipped.map((f, i) => (
                    <div key={i} className="text-xs text-yellow-400/80 font-mono truncate">{f}</div>
                  ))}
                </div>
              </details>
            )}
            {op.fileResults.failed.length > 0 && (
              <details className="group">
                <summary className="text-xs font-medium text-red-400 cursor-pointer list-none flex items-center gap-1 hover:text-red-300 select-none py-1">
                  <span className="opacity-60 group-open:opacity-100 transition-opacity">▶</span>
                  Failed ({op.fileResults.failed.length})
                </summary>
                <div className="mt-1 ml-3 space-y-0.5">
                  {op.fileResults.failed.map((f, i) => (
                    <div key={i} className="text-xs text-red-400/80 font-mono truncate">{f}</div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
        <div className="px-6 pb-3">
          <CopyButton text={`[${op.status}] ${kindLabel}: ${op.path || op.directoryPath || ''} — ${op.message}`} />
        </div>
      </div>
    );
  },
  copyFormatter: (data: any) => {
    const op = data as OperationResultData;
    if (!op || !op.kind) return '';
    const kindLabel = getKindLabel(op.kind);
    const path = op.path || op.directoryPath || '';
    let result = `[${op.status}] ${kindLabel}: ${path} — ${op.message}`;
    if (op.fileResults) {
      if (op.fileResults.modified.length > 0) {
        result += `\n  Modified: ${op.fileResults.modified.join(', ')}`;
      }
      if (op.fileResults.skipped.length > 0) {
        result += `\n  Skipped: ${op.fileResults.skipped.join(', ')}`;
      }
      if (op.fileResults.failed.length > 0) {
        result += `\n  Failed: ${op.fileResults.failed.join(', ')}`;
      }
    }
    return result;
  },
};