import { AlertCircle, ChevronRight, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { ToolResultRenderer } from '../types';
import type { ReportSection } from '@brud/protocol';

interface ErrorResultData {
  structured?: ReportSection[];
  friendlyMessage: string;
}

function StatusBadge({ status }: { status: 'success' | 'failed' | 'aborted' }) {
  const colors: Record<string, string> = {
    success: 'bg-green-500/10 text-green-400 border-green-500/30',
    failed: 'bg-red-500/10 text-red-400 border-red-500/30',
    aborted: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${colors[status]}`}>
      {status}
    </span>
  );
}

function CopyButton({ text, buttonText }: { text: string; buttonText?: string }) {
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
      {copied ? <><Check size={12} /> Copied!</> : <><Copy size={12} /> {buttonText || 'Copy'}</>}
    </button>
  );
}

function ActionButton({ section }: { section: ReportSection }) {
  return (
    <button
      className="flex items-center gap-1.5 text-xs text-primary hover:text-primary-hover cursor-pointer bg-surface-2 border border-border-subtle rounded px-3 py-2 transition-colors w-full text-left"
    >
      {section.buttonText || 'See Details'}
      <ChevronRight size={12} />
    </button>
  );
}

function renderSectionContent(section: ReportSection, index: number) {
  switch (section.type) {
    case 'summary':
      return (
        <div key={index}>
          {section.title && <div className="text-xs font-semibold text-text mb-2 uppercase tracking-wider">{section.title}</div>}
          <div className="flex flex-wrap gap-2">
            {section.items?.map((item, j) => (
              <div key={j} className="flex items-center gap-1.5 bg-surface-2 border border-border-subtle rounded px-2.5 py-1.5 text-xs">
                {item.status ? <StatusBadge status={item.status} /> : null}
                <span className="text-text-secondary shrink-0">{item.label}:</span>
                <span className="text-text font-medium">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      );
    case 'table':
      return (
        <div key={index}>
          {section.title && <div className="text-xs font-semibold text-text mb-2 uppercase tracking-wider">{section.title}</div>}
          <div className="flex flex-col gap-1">
            {section.items?.map((item, j) => (
              <div key={j} className="flex items-start gap-2 bg-surface-2 border border-border-subtle rounded px-2.5 py-1.5 text-xs">
                <ChevronRight size={12} className="text-text-secondary shrink-0 mt-0.5" />
                <span className="text-text-secondary shrink-0 min-w-[80px]">{item.label}</span>
                <span className="text-text flex-1">{item.value}</span>
                {item.status && <StatusBadge status={item.status} />}
              </div>
            ))}
          </div>
        </div>
      );
    case 'details':
      return (
        <div key={index}>
          {section.title && <div className="text-xs font-semibold text-text mb-2 uppercase tracking-wider">{section.title}</div>}
          {section.content && (
            <pre className="text-xs text-text-secondary bg-surface-2 border border-border-subtle rounded p-2 whitespace-pre-wrap overflow-x-auto max-h-[200px] overflow-y-auto">
              {section.content}
            </pre>
          )}
        </div>
      );
    case 'text':
      return (
        <div key={index} className="text-sm text-text leading-relaxed">
          {section.content}
        </div>
      );
    case 'copyButton':
      return (
        <div key={index}>
          <CopyButton text={section.copyText || ''} buttonText={section.buttonText} />
        </div>
      );
    case 'button':
      return (
        <div key={index}>
          <ActionButton section={section} />
        </div>
      );
    default:
      return null;
  }
}

function formatSectionForCopy(section: ReportSection): string {
  const lines: string[] = [];
  if (section.title) lines.push(section.title);
  if (section.content) lines.push(section.content);
  if (section.items) {
    for (const item of section.items) {
      const status = item.status ? `[${item.status}] ` : '';
      lines.push(`${status}${item.label}: ${item.value}`);
    }
  }
  if (section.buttonText) lines.push(`[Action: ${section.buttonText}]`);
  return lines.join('\n');
}

export const errorRenderer: ToolResultRenderer = {
  toolKind: 'error',
  title: 'Error',
  renderSection: (data: any) => {
    const errorData = data as ErrorResultData;
    if (!errorData || !errorData.friendlyMessage) return null;

    return (
      <div>
        <div className="px-6 py-3 border-b border-border bg-red-500/10">
          <div className="flex items-start gap-3">
            <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-medium text-red-400">Error</div>
              <div className="text-xs text-red-300 mt-1">{errorData.friendlyMessage}</div>
            </div>
          </div>
        </div>
        {errorData.structured && errorData.structured.length > 0 && (
          <div className="p-6 space-y-3">
            {errorData.structured.map((section, i) => renderSectionContent(section, i))}
          </div>
        )}
      </div>
    );
  },
  copyFormatter: (data: any) => {
    const errorData = data as ErrorResultData;
    if (!errorData || !errorData.friendlyMessage) return '';
    const lines: string[] = [
      `Error: ${errorData.friendlyMessage}`,
    ];
    if (errorData.structured) {
      for (const section of errorData.structured) {
        lines.push('');
        lines.push(formatSectionForCopy(section));
      }
    }
    return lines.join('\n');
  },
};