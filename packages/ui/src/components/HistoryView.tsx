import { useState, useEffect, useCallback } from 'react';
import { History, CheckCircle, XCircle, Clock, FileText } from 'lucide-react';
import type { HistorySessionResult } from '@brud/protocol';
import { sendToExtension, onExtensionMessage } from '../bridge/vscodeBridge';

function formatDateHeader(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (target.getTime() === today.getTime()) return 'Today';
  if (target.getTime() === yesterday.getTime()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function groupByDate(sessions: HistorySessionResult[]): Map<string, HistorySessionResult[]> {
  const groups = new Map<string, HistorySessionResult[]>();
  for (const session of sessions) {
    const header = formatDateHeader(session.timestamp);
    const list = groups.get(header) || [];
    list.push(session);
    groups.set(header, list);
  }
  return groups;
}

function HistoryView() {
  const [sessions, setSessions] = useState<HistorySessionResult[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    sendToExtension({ command: 'getHistory' });

    const unsubscribe = onExtensionMessage((message) => {
      if (message.command === 'historyResult' && message.history) {
        const sorted = [...message.history].sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        setSessions(sorted);
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  const grouped = groupByDate(sessions);

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <Clock size={32} className="text-text-secondary mb-4" />
        <p className="text-sm text-text-secondary">Loading history...</p>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <History size={48} className="text-text-secondary mb-4" />
        <h3 className="text-lg font-medium text-text mb-2">No sessions recorded yet</h3>
        <p className="text-sm text-text-secondary text-center max-w-sm">
          Brud sessions will appear here once you start using Brud in this workspace.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col px-6 py-6 max-w-4xl mx-auto w-full">
      <div className="flex items-center gap-3 mb-6">
        <History size={24} className="text-text" />
        <h2 className="text-2xl font-semibold text-text">History</h2>
      </div>

      <div className="flex flex-col gap-6">
        {Array.from(grouped.entries()).map(([dateHeader, dateSessions]) => (
          <div key={dateHeader}>
            <h3 className="text-sm font-medium text-text-secondary mb-3 sticky top-0 bg-surface py-1">
              {dateHeader}
            </h3>
            <div className="flex flex-col gap-2">
              {dateSessions.map((session) => {
                const isSelected = selectedSessionId === session.sessionId;
                return (
                  <button
                    key={session.sessionId}
                    onClick={() => setSelectedSessionId(
                      isSelected ? null : session.sessionId
                    )}
                    className={`flex items-start gap-3 p-4 rounded-lg border text-left cursor-pointer transition-colors ${
                      isSelected
                        ? 'border-primary bg-surface-2'
                        : 'border-border bg-surface hover:bg-surface-2 hover:border-border-subtle'
                    }`}
                  >
                    <div className="mt-0.5 shrink-0">
                      {session.status === 'success' ? (
                        <CheckCircle size={18} className="text-green-500" />
                      ) : (
                        <XCircle size={18} className="text-red-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-sm font-mono font-medium text-text">
                          {session.sessionId}
                        </span>
                        <span className="text-xs text-text-secondary shrink-0">
                          {formatTime(session.timestamp)}
                        </span>
                      </div>
                      <p className="text-sm text-text-secondary line-clamp-1 mb-1.5">
                        {session.originalPrompt.length > 50
                          ? session.originalPrompt.slice(0, 50) + '...'
                          : session.originalPrompt}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-text-secondary">
                        <span className="flex items-center gap-1">
                          <FileText size={12} />
                          {session.operationCount} ops
                        </span>
                        <span className="flex items-center gap-1">
                          <FileText size={12} />
                          {session.filesAffected.length} files
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default HistoryView;