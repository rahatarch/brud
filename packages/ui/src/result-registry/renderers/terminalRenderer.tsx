import { Terminal } from 'lucide-react';
import { ToolResultRenderer } from '../types';

interface TerminalResultData {
  command: string;
  output: string;
  exitCode: number | null;
  duration: number;
  success: boolean;
}

function formatDuration(seconds: number): string {
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`;
  return `${seconds.toFixed(1)}s`;
}

export const terminalRenderer: ToolResultRenderer = {
  toolKind: 'terminal_command',
  title: 'Terminal Command',
  renderSection: (data: any) => {
    const termData = data as TerminalResultData;
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
  },
  copyFormatter: (data: any) => {
    const termData = data as TerminalResultData;
    if (!termData) return '';
    return [
      `Command: ${termData.command}`,
      `Status: ${termData.success ? 'success' : 'failure'}`,
      `Duration: ${formatDuration(termData.duration)}`,
      `Exit Code: ${termData.exitCode !== null ? termData.exitCode : 'N/A'}`,
      'Output:',
      termData.output,
    ].join('\n');
  },
};