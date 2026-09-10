import { ToolResultRenderer } from '../types';

export const toolInfoRenderer: ToolResultRenderer = {
  toolKind: 'tool_info',
  title: 'Tool Information',
  renderSection: (data: any) => {
    if (!data || !data.message) return null;
    return (
      <div>
        <div className="px-6 py-3 border-b border-border bg-surface-2 text-xs text-text-secondary flex items-center gap-2">
          <span className="font-medium">Status:</span>
          <span className="font-mono">{data.status}</span>
        </div>
        <div className="p-6">
          <pre className="text-xs text-text-secondary font-mono whitespace-pre leading-relaxed bg-surface-2 border border-border rounded p-4 overflow-x-auto max-h-150 overflow-y-auto">
            {data.message}
          </pre>
        </div>
      </div>
    );
  },
  copyFormatter: (data: any) => {
    if (!data || !data.message) return '';
    return data.message;
  },
  summaryFormatter: (data: any) => {
    if (!data) return '';
    const status = data.status || 'success';
    const kind = data.kind || 'tool_info';
    return `[${status}] Tool Info: ${kind}`;
  },
};