import { Terminal } from 'lucide-react';
import { ToolResultRenderer } from '../types';

interface TerminalResultData {
  command: string;
  output: string;
  exitCode: number | null;
  duration: number;
  success: boolean;
}

interface GroupResultData {
  mode: 'single' | 'sequential' | 'parallel' | 'conditional';
  results: TerminalResultData[];
  totalDuration: number;
  succeeded: number;
  failed: number;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function renderSingleCommand(termData: TerminalResultData) {
  if (!termData || !termData.command) return null;

  return (
    <div>
      <div className="px-6 py-2 border-b border-border bg-surface-2 text-xs text-text-secondary flex items-center gap-2">
        <Terminal size={14} className="text-text-tertiary" />
        <span className="font-mono truncate flex-1">{termData.command}</span>
        <span className={`inline-flex items-center gap-1 font-medium ${termData.success ? 'text-green-500' : 'text-red-500'}`}>
          {termData.success ? (
            <><span className="text-green-500">&#10003;</span> Success</>
          ) : (
            <><span className="text-red-500">&#10007;</span> Failed</>
          )}
        </span>
      </div>
      <div className="px-6 py-3 space-y-2">
        <div className="flex gap-4 text-xs text-text-secondary">
          <span>Duration: <span className="font-mono text-text tabular-nums">{formatDuration(termData.duration)}</span></span>
          <span>Exit Code: <span className="font-mono text-text tabular-nums">{termData.exitCode !== null ? termData.exitCode : 'N/A'}</span></span>
        </div>
        {termData.output && (
          <pre className="text-xs text-text-secondary font-mono whitespace-pre leading-relaxed bg-surface-2 border border-border rounded p-4 overflow-x-auto max-h-150 overflow-y-auto">
            {termData.output}
          </pre>
        )}
      </div>
    </div>
  );
}

function formatSingleCopy(termData: TerminalResultData): string {
  return [
    `Command: ${termData.command}`,
    `Status: ${termData.success ? 'success' : 'failure'}`,
    `Duration: ${formatDuration(termData.duration)}`,
    `Exit Code: ${termData.exitCode !== null ? termData.exitCode : 'N/A'}`,
    'Output:',
    termData.output,
  ].join('\n');
}

function isGroupResultData(data: any): data is GroupResultData {
  return data && typeof data === 'object' && 'mode' in data && 'results' in data;
}

function renderGroupCommand(groupData: GroupResultData) {
  const modeLabel = groupData.mode.charAt(0).toUpperCase() + groupData.mode.slice(1);
  return (
    <div>
      <div className="px-6 py-3 border-b border-border bg-surface-1">
        <div className="flex items-center gap-3">
          <Terminal size={14} className="text-text-tertiary" />
          <span className="text-sm font-medium text-text">{modeLabel} Group</span>
          <span className="text-xs text-text-secondary">{groupData.results.length} command{groupData.results.length !== 1 ? 's' : ''}</span>
          <span className="text-xs text-green-500 ml-auto">{groupData.succeeded} succeeded</span>
          {groupData.failed > 0 && <span className="text-xs text-red-500">{groupData.failed} failed</span>}
          <span className="text-xs text-text-secondary">Total: {formatDuration(groupData.totalDuration)}</span>
        </div>
      </div>
      {groupData.results.map((item, index) => (
        <div key={index}>
          {index > 0 && <hr className="my-2 border-border" />}
          {renderSingleCommand(item)}
        </div>
      ))}
    </div>
  );
}

export const terminalRenderer: ToolResultRenderer = {
  toolKind: 'terminal_command',
  title: 'Terminal Command',
  renderSection: (data: any) => {
    if (isGroupResultData(data)) {
      return renderGroupCommand(data);
    }
    if (Array.isArray(data)) {
      return (
        <div>
          {data.map((item, index) => (
            <div key={index}>
              {index > 0 && <hr className="my-2 border-border" />}
              {renderSingleCommand(item)}
            </div>
          ))}
        </div>
      );
    }
    return renderSingleCommand(data);
  },
  copyFormatter: (data: any) => {
    if (isGroupResultData(data)) {
      const lines: string[] = [
        `Group Mode: ${data.mode}`,
        `Commands: ${data.results.length}`,
        `Succeeded: ${data.succeeded}`,
        `Failed: ${data.failed}`,
        `Total Duration: ${formatDuration(data.totalDuration)}`,
        '',
      ];
      for (const item of data.results) {
        lines.push(formatSingleCopy(item));
        lines.push('---');
      }
      return lines.join('\n');
    }
    if (Array.isArray(data)) {
      return data.map(formatSingleCopy).join('\n\n---\n\n');
    }
    const termData = data as TerminalResultData;
    if (!termData) return '';
    return formatSingleCopy(termData);
  },
  summaryFormatter: (data: any) => {
    if (isGroupResultData(data)) {
      const status = data.failed > 0 ? 'failure' : 'success';
      return `[${status}] Terminal Group (${data.mode}): ${data.results.length} commands, ${data.succeeded} succeeded, ${data.failed} failed, ${formatDuration(data.totalDuration)}`;
    }
    if (Array.isArray(data)) {
      const succeeded = data.filter(r => r.success).length;
      const failed = data.filter(r => !r.success).length;
      const totalDuration = data.reduce((sum, r) => sum + (r.duration || 0), 0);
      const status = failed > 0 ? 'failure' : 'success';
      return `[${status}] Terminal Commands: ${data.length} commands, ${succeeded} succeeded, ${failed} failed, ${formatDuration(totalDuration)}`;
    }
    const termData = data as TerminalResultData;
    if (!termData || !termData.command) return '';
    const status = termData.success ? 'success' : 'failure';
    return `[${status}] Terminal: ${termData.command} — exit ${termData.exitCode !== null ? termData.exitCode : 'N/A'}, ${formatDuration(termData.duration)}`;
  },
};