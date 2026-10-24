import { Terminal, XCircle, Loader } from 'lucide-react';
import { getTerminalStreamingState, isTerminalGroupPayload, isTerminalPayload, isTerminalResultPayload } from '../types';
import type { TerminalGroupPayload, TerminalResultPayload, ToolResultRenderer } from '../types';
import { sendKillProcess } from '../../bridge/vscodeBridge';
import { appendDiagnosticCopy, DiagnosticDisclosure } from './diagnostics';

declare global {
  interface Window {
    __terminalChunks?: Map<string, { chunks: string[]; isRunning: boolean; processId?: string }>;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function renderSingleCommand(termData: TerminalResultPayload, isRunning: boolean, processId?: string) {
  if (!termData.command) return null;

  return (
    <div>
      <div className="px-6 py-2 border-b border-border bg-surface-2 text-xs text-text-secondary flex items-center gap-2">
        <Terminal size={14} className="text-text-tertiary" />
        <span className="font-mono truncate flex-1">{termData.command}</span>
        {isRunning ? (
          <span className="inline-flex items-center gap-1 font-medium text-yellow-500">
            <Loader size={14} className="animate-spin" />
            Running...
          </span>
        ) : (
          <span className={`inline-flex items-center gap-1 font-medium ${termData.success ? 'text-green-500' : 'text-red-500'}`}>
            {termData.success ? (
              <><span className="text-green-500">&#10003;</span> Success</>
            ) : (
              <><span className="text-red-500">&#10007;</span> Failed</>
            )}
          </span>
        )}
        {isRunning && processId && (
          <button
            onClick={() => sendKillProcess(processId)}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500/20 transition-colors cursor-pointer"
            title="Kill process"
          >
            <XCircle size={12} />
            Kill
          </button>
        )}
      </div>
      <div className="px-6 py-3 space-y-2">
        <div className="flex gap-4 text-xs text-text-secondary">
          <span>Duration: <span className="font-mono text-text tabular-nums">{isRunning ? 'running...' : formatDuration(termData.duration)}</span></span>
          <span>Exit Code: <span className="font-mono text-text tabular-nums">{termData.exitCode !== null ? termData.exitCode : isRunning ? '...' : 'N/A'}</span></span>
        </div>
        {termData.output && (
          <pre className="text-xs text-text-secondary font-mono whitespace-pre leading-relaxed bg-surface-2 border border-border rounded p-4 overflow-x-auto max-h-150 overflow-y-auto">
            {termData.output}
          </pre>
        )}
        {!termData.success && (
          <DiagnosticDisclosure code={termData.code} details={termData.details} />
        )}
      </div>
    </div>
  );
}

function formatSingleCopy(termData: TerminalResultPayload): string {
  const lines = [
    `Command: ${termData.command}`,
    `Status: ${termData.success ? 'success' : 'failure'}`,
    `Duration: ${formatDuration(termData.duration)}`,
    `Exit Code: ${termData.exitCode !== null ? termData.exitCode : 'N/A'}`,
    'Output:',
    termData.output,
  ];
  return appendDiagnosticCopy(lines, termData).join('\n');
}

function renderGroupCommand(groupData: TerminalGroupPayload, isRunning: boolean, processId?: string) {
  const modeLabel = groupData.mode.charAt(0).toUpperCase() + groupData.mode.slice(1);
  return (
    <div>
      <div className="px-6 py-3 border-b border-border bg-surface-1">
        <div className="flex items-center gap-3">
          <Terminal size={14} className="text-text-tertiary" />
          <span className="text-sm font-medium text-text">{modeLabel} Group</span>
          <span className="text-xs text-text-secondary">{groupData.results.length} command{groupData.results.length !== 1 ? 's' : ''}</span>
          {!isRunning && <span className="text-xs text-green-500 ml-auto">{groupData.succeeded} succeeded</span>}
          {!isRunning && groupData.failed > 0 && <span className="text-xs text-red-500">{groupData.failed} failed</span>}
          {isRunning && <span className="text-xs text-yellow-500 ml-auto">Running...</span>}
          {isRunning && processId && (
            <button
              onClick={() => sendKillProcess(processId)}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500/20 transition-colors cursor-pointer"
              title="Kill process"
            >
              <XCircle size={12} />
              Kill
            </button>
          )}
        </div>
      </div>
      {groupData.results.map((item, index) => (
        <div key={index}>
          {index > 0 && <hr className="my-2 border-border" />}
          {renderSingleCommand(item, false)}
        </div>
      ))}
    </div>
  );
}

function asTerminalResults(data: unknown): TerminalResultPayload[] | null {
  if (!Array.isArray(data)) {
    return null;
  }
  const results = data.filter(isTerminalResultPayload);
  return results.length === data.length ? results : null;
}

export const terminalRenderer: ToolResultRenderer = {
  toolKind: 'terminal_command',
  title: 'Terminal Command',
  canRender: (data: unknown) => isTerminalPayload(data),
  renderSection: (data: unknown) => {
    const { isRunning, processId } = getTerminalStreamingState(data);

    if (isTerminalGroupPayload(data)) {
      return renderGroupCommand(data, isRunning, processId);
    }
    const results = asTerminalResults(data);
    if (results) {
      return (
        <div>
          {results.map((item, index) => (
            <div key={index}>
              {index > 0 && <hr className="my-2 border-border" />}
              {renderSingleCommand(item, false)}
            </div>
          ))}
        </div>
      );
    }
    if (isTerminalResultPayload(data)) {
      return renderSingleCommand(data, isRunning, processId);
    }
    return null;
  },
  copyFormatter: (data: unknown) => {
    if (isTerminalGroupPayload(data)) {
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
    const results = asTerminalResults(data);
    if (results) {
      return results.map(formatSingleCopy).join('\n\n---\n\n');
    }
    if (isTerminalResultPayload(data)) {
      return formatSingleCopy(data);
    }
    return '';
  },
  summaryFormatter: (data: unknown) => {
    if (isTerminalGroupPayload(data)) {
      const status = data.failed > 0 ? 'failure' : 'success';
      return `[${status}] Terminal Group (${data.mode}): ${data.results.length} commands, ${data.succeeded} succeeded, ${data.failed} failed, ${formatDuration(data.totalDuration)}`;
    }
    const results = asTerminalResults(data);
    if (results) {
      const succeeded = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
      const status = failed > 0 ? 'failure' : 'success';
      return `[${status}] Terminal Commands: ${results.length} commands, ${succeeded} succeeded, ${failed} failed, ${formatDuration(totalDuration)}`;
    }
    if (isTerminalResultPayload(data) && data.command) {
      const status = data.success ? 'success' : 'failure';
      return `[${status}] Terminal: ${data.command} — exit ${data.exitCode !== null ? data.exitCode : 'N/A'}, ${formatDuration(data.duration)}`;
    }
    return '';
  },
};
