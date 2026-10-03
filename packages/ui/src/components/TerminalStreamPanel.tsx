import { useState, useEffect, useRef } from 'react';
import { XCircle, Terminal, Loader2 } from 'lucide-react';
import { sendKillProcess, onExtensionMessage } from '../bridge/vscodeBridge';

interface ProcessStream {
  buffer: string;
  isRunning: boolean;
  status: 'running' | 'success' | 'failed' | 'interrupted';
}

function TerminalStreamPanel() {
  const [processes, setProcesses] = useState<Map<string, ProcessStream>>(new Map());
  const outputRefs = useRef<Map<string, HTMLPreElement>>(new Map());

  useEffect(() => {
    return onExtensionMessage((message) => {
      if (message.command !== 'terminalChunk') return;

      const processId = message.processId || 'default';
      const chunk = message.chunk || '';

      setProcesses((prev) => {
        const next = new Map(prev);
        const existing = next.get(processId) || {
          buffer: '',
          isRunning: true,
          status: 'running' as const,
        };

        if (message.streamDone) {
          next.set(processId, {
            ...existing,
            isRunning: false,
            status: message.streamStatus || 'success',
          });
        } else {
          next.set(processId, {
            ...existing,
            buffer: existing.buffer + chunk,
          });
        }

        return next;
      });
    });
  }, []);

  useEffect(() => {
    for (const [processId] of processes) {
      const el = outputRefs.current.get(processId);
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [processes]);

  const handleKill = (processId: string) => {
    sendKillProcess(processId);
  };

  const processCount = processes.size;
  const runningCount = Array.from(processes.values()).filter((p) => p.isRunning).length;

  if (processCount === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-[#0d1117] text-[#8b949e] p-8">
        <Terminal size={48} className="mb-4 opacity-40" />
        <h2 className="text-lg font-semibold text-[#e6edf3] mb-2">Brud Terminal Stream</h2>
        <p className="text-sm text-center">Waiting for terminal operations...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#0d1117] text-[#e6edf3] overflow-hidden">
      <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-[#30363d] bg-[#161b22]">
        <div className="flex items-center gap-2">
          <Terminal size={16} className="text-[#58a6ff]" />
          <span className="text-sm font-semibold">Brud Terminal Stream</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-[#8b949e]">
          <span>{processCount} process{processCount !== 1 ? 'es' : ''}</span>
          {runningCount > 0 && (
            <span className="flex items-center gap-1 text-[#58a6ff]">
              <Loader2 size={12} className="animate-spin" />
              {runningCount} running
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {Array.from(processes.entries()).map(([processId, stream]) => (
          <div
            key={processId}
            className="border border-[#30363d] rounded-md overflow-hidden"
          >
            <div className="flex items-center justify-between px-3 py-1.5 bg-[#161b22] border-b border-[#30363d]">
              <div className="flex items-center gap-2 text-xs">
                <Terminal size={12} className="text-[#8b949e]" />
                <span className="font-mono text-[#e6edf3]">{processId}</span>
                {stream.isRunning ? (
                  <span className="flex items-center gap-1 text-[#58a6ff]">
                    <Loader2 size={10} className="animate-spin" />
                    Running
                  </span>
                ) : (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      stream.status === 'success'
                        ? 'bg-[#238636]/20 text-[#3fb950]'
                        : stream.status === 'failed'
                        ? 'bg-[#da3633]/20 text-[#f85149]'
                        : 'bg-[#d29922]/20 text-[#d29922]'
                    }`}
                  >
                    {stream.status}
                  </span>
                )}
              </div>
              {stream.isRunning && (
                <button
                  onClick={() => handleKill(processId)}
                  className="flex items-center gap-1 text-[10px] text-[#f85149] hover:text-[#ff6b6b] cursor-pointer bg-transparent border border-[#da3633]/40 rounded px-2 py-0.5 transition-colors"
                  title="Kill Process"
                >
                  <XCircle size={10} />
                  Kill
                </button>
              )}
            </div>
            <pre
              ref={(el) => {
                if (el) outputRefs.current.set(processId, el);
              }}
              className="m-0 p-3 text-xs font-mono text-[#e6edf3] bg-[#0d1117] overflow-auto max-h-[300px] whitespace-pre-wrap break-all leading-[1.5]"
            >
              {stream.buffer || (
                <span className="text-[#484f58] italic">No output yet...</span>
              )}
            </pre>
          </div>
        ))}
      </div>

      <div className="shrink-0 px-4 py-1.5 border-t border-[#30363d] bg-[#161b22] text-[10px] text-[#8b949e]">
        {runningCount > 0
          ? `${runningCount} process${runningCount !== 1 ? 'es' : ''} still running`
          : 'All processes completed'}
      </div>
    </div>
  );
}

export default TerminalStreamPanel;