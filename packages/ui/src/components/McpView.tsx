import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Play, Square } from 'lucide-react';
import { sendToExtension, onExtensionMessage } from '../bridge/vscodeBridge';
import type { McpStatusPayload } from '@brud/protocol';

const phaseLabel: Record<McpStatusPayload['phase'], string> = {
  stopped: 'Stopped',
  starting: 'Starting',
  running: 'Running',
  stopping: 'Stopping',
};

const phaseTone: Record<McpStatusPayload['phase'], string> = {
  stopped: 'bg-surface-3 text-text-secondary border-border-subtle',
  starting: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
  running: 'bg-green-500/10 text-green-400 border-green-500/30',
  stopping: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
};

function McpView() {
  const [status, setStatus] = useState<McpStatusPayload | null>(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    sendToExtension({ command: 'getMcpStatus' });
    return onExtensionMessage((message) => {
      if (message.command === 'mcpStatus' && message.mcpStatus) {
        setStatus(message.mcpStatus);
      }
      if (message.command === 'mcpConfigCopied') {
        if (message.message && message.message.startsWith('{')) {
          setCopied(true);
          setNotice(null);
          setTimeout(() => setCopied(false), 2000);
        } else {
          setNotice(message.message ?? 'Could not copy the configuration.');
        }
      }
    });
  }, []);

  const handleStart = useCallback(() => {
    sendToExtension({ command: 'startMcpServer' });
  }, []);

  const handleStop = useCallback(() => {
    sendToExtension({ command: 'stopMcpServer' });
  }, []);

  const handleAutoOn = useCallback(() => {
    sendToExtension({ command: 'setMcpAutoOn', enabled: !(status?.autoOn ?? true) });
  }, [status]);

  const handleCopy = useCallback(() => {
    sendToExtension({ command: 'copyMcpConfig' });
  }, []);

  const phase = status?.phase ?? 'stopped';
  const isRunning = phase === 'running';
  const isBusy = phase === 'starting' || phase === 'stopping';

  return (
    <div className="flex-1 flex flex-col gap-4 px-6 py-6 max-w-4xl mx-auto w-full min-h-0 overflow-y-auto">
      <div className="bg-surface-2 border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text">Server</span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${phaseTone[phase]}`}>
              {phaseLabel[phase]}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleStart}
              disabled={isRunning || isBusy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <Play size={12} /> Start
            </button>
            <button
              onClick={handleStop}
              disabled={!isRunning || isBusy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-surface-3 text-text-secondary border border-border-subtle hover:text-text transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <Square size={12} /> Stop
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5 text-xs">
          <div className="flex items-start gap-2">
            <span className="text-text-secondary min-w-[92px]">Endpoint</span>
            <span className="text-text font-medium break-all">{status?.url ?? 'Not listening'}</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-text-secondary min-w-[92px]">Project</span>
            <span className="text-text break-all">{status?.workspaceRoot ?? 'No project folder open'}</span>
          </div>
          {status?.error ? (
            <div className="flex items-start gap-2">
              <span className="text-text-secondary min-w-[92px]">Problem</span>
              <span className="text-red-400 break-words">{status.error}</span>
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={handleCopy}
            disabled={!isRunning}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-surface-3 text-text-secondary border border-border-subtle hover:text-text transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy connection details'}
          </button>
          {notice ? <span className="text-xs text-text-secondary">{notice}</span> : null}
        </div>
      </div>

      <div className="bg-surface-2 border border-border rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="pr-4">
            <span className="text-sm font-medium text-text block">Start when a project opens</span>
            <span className="text-xs text-text-secondary block">
              Brud listens on this machine only. Turn this off to start the server manually.
            </span>
          </div>
          <button
            onClick={handleAutoOn}
            className={`relative w-9 h-5 rounded-full transition-colors shrink-0 cursor-pointer ${
              (status?.autoOn ?? true) ? 'bg-primary' : 'bg-surface-3'
            }`}
          >
            <span
              className={`block w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${
                (status?.autoOn ?? true) ? 'translate-x-[18px]' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

export default McpView;
