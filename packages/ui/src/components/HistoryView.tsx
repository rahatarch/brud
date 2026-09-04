import { useState, useEffect, useCallback } from 'react';
import { History, CheckCircle, XCircle, AlertCircle, Clock, FileText, ArrowLeft, Loader2, AlertTriangle } from 'lucide-react';
import type { HistorySessionResult, RevertSessionResult } from '@brud/protocol';
import { sendToExtension, onExtensionMessage } from '../bridge/vscodeBridge';
import ConfirmationModal from './ConfirmationModal';
import WipeConfirmationModal from './WipeConfirmationModal';

function formatDateHeader(timestamp?: string): string {
  if (!timestamp) return 'Unknown Date';
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return 'Unknown Date';
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (target.getTime() === today.getTime()) return 'Today';
    if (target.getTime() === yesterday.getTime()) return 'Yesterday';
    return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  } catch {
    return 'Unknown Date';
  }
}

function formatTime(timestamp?: string): string {
  if (!timestamp) return '--:--';
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return '--:--';
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '--:--';
  }
}

function formatFullDateTime(timestamp?: string): string {
  if (!timestamp) return 'Unknown date and time';
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return 'Unknown date and time';
    return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      + ' at ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return 'Unknown date and time';
  }
}

function groupByDate(sessions: HistorySessionResult[]): Map<string, HistorySessionResult[]> {
  const groups = new Map<string, HistorySessionResult[]>();
  for (const session of sessions) {
    const header = session.timestamp ? formatDateHeader(session.timestamp) : 'Unknown Date';
    const list = groups.get(header) || [];
    list.push(session);
    groups.set(header, list);
  }
  return groups;
}

function statusIcon(status?: string) {
  switch (status || 'unknown') {
    case 'success': return <CheckCircle size={18} className="text-green-500" />;
    case 'aborted': return <AlertCircle size={18} className="text-yellow-500" />;
    case 'failed': return <XCircle size={18} className="text-red-500" />;
    default: return <XCircle size={18} className="text-red-500" />;
  }
}

function statusBadge(status?: string) {
  const base = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium';
  switch (status || 'unknown') {
    case 'success':
      return <span className={`${base} bg-green-500/10 text-green-500`}>Success</span>;
    case 'aborted':
      return <span className={`${base} bg-yellow-500/10 text-yellow-500`}>Aborted</span>;
    case 'failed':
      return <span className={`${base} bg-red-500/10 text-red-500`}>Failed</span>;
    default:
      return <span className={`${base} bg-red-500/10 text-red-500`}>Unknown</span>;
  }
}

function formatKind(kind: string): string {
  return kind.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function DetailView({ session, onBack }: { session: HistorySessionResult; onBack: () => void }) {
  const sessionId = session.sessionId || 'Unknown Session';
  const timestamp = session.timestamp;
  const status = session.status || 'unknown';
  const originalPrompt = session.originalPrompt || 'No prompt recorded.';
  const operations = session.operations || [];
  const operationCount = session.operationCount || 0;
  const operationTypes = session.operationTypes || [];
  const filesAffected = session.filesAffected || [];
  const metadataUsed = session.metadataUsed || {};
  const hasMetadata = Object.keys(metadataUsed).length > 0;
  const [revertLoading, setRevertLoading] = useState<'pre' | 'post' | null>(null);
  const [revertResult, setRevertResult] = useState<RevertSessionResult | null>(null);
  const [revertDismissed, setRevertDismissed] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingTargetState, setPendingTargetState] = useState<'pre' | 'post' | null>(null);

  useEffect(() => {
    const unsubscribe = onExtensionMessage((message) => {
      if (message.command === 'revertResult' && message.revertResult) {
        setRevertResult(message.revertResult);
        setRevertLoading(null);
        if (message.revertResult.success) {
          setTimeout(() => {
            onBack();
          }, 2000);
        }
      }
    });
    return unsubscribe;
  }, [onBack]);

  const handleRevert = useCallback((targetState: 'pre' | 'post') => {
    setPendingTargetState(targetState);
    setShowConfirmModal(true);
  }, []);

  const handleConfirmRevert = useCallback(() => {
    if (!pendingTargetState) return;
    setShowConfirmModal(false);
    setRevertLoading(pendingTargetState);
    setRevertResult(null);
    setRevertDismissed(false);
    sendToExtension({ command: 'revertSession', sessionId, targetState: pendingTargetState });
    setPendingTargetState(null);
  }, [pendingTargetState, sessionId]);

  const handleCancelRevert = useCallback(() => {
    setShowConfirmModal(false);
    setPendingTargetState(null);
  }, []);

  const dismissResult = useCallback(() => {
    setRevertResult(null);
    setRevertDismissed(true);
  }, []);

  try {
    return (
      <div className="flex-1 flex flex-col px-6 py-6 max-w-4xl mx-auto w-full">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-text-secondary hover:text-text mb-6 transition-colors cursor-pointer"
        >
          <ArrowLeft size={16} />
          Back to History
        </button>

        <div className="flex items-start justify-between gap-4 mb-1">
          <div>
            <h2 className="text-xl font-semibold text-text font-mono">{sessionId}</h2>
            <p className="text-sm text-text-secondary mt-1">{timestamp ? formatFullDateTime(timestamp) : 'No date recorded'}</p>
          </div>
          {statusBadge(status)}
        </div>

        <div className="flex gap-3 mt-4">
          <button
            onClick={() => handleRevert('pre')}
            disabled={revertLoading !== null}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              revertLoading === 'pre'
                ? 'bg-primary/30 text-primary border border-primary/30 cursor-wait'
                : 'bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 cursor-pointer'
            }`}
          >
            {revertLoading === 'pre' ? (
              <span className="flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" />
                Reverting...
              </span>
            ) : (
              'Restore Pre-Patch State'
            )}
          </button>
          <button
            onClick={() => handleRevert('post')}
            disabled={revertLoading !== null}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              revertLoading === 'post'
                ? 'bg-primary/30 text-primary border border-primary/30 cursor-wait'
                : 'border border-border bg-surface text-text-secondary hover:bg-surface-2 hover:text-text cursor-pointer'
            }`}
          >
            {revertLoading === 'post' ? (
              <span className="flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" />
                Reverting...
              </span>
            ) : (
              'Restore Post-Patch State'
            )}
          </button>
        </div>

        {revertResult && !revertDismissed && (
          <div className={`mt-4 p-4 rounded-lg border ${
            revertResult.success
              ? 'bg-green-500/10 border-green-500/30 text-green-500'
              : 'bg-red-500/10 border-red-500/30 text-red-500'
          }`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <p className="text-sm font-medium">
                  {revertResult.success ? 'Revert Successful' : 'Revert Failed'}
                </p>
                <p className="text-sm mt-1 opacity-80">{revertResult.message}</p>
                {revertResult.errors.length > 0 && (
                  <ul className="mt-2 text-xs space-y-1">
                    {revertResult.errors.map((err, i) => (
                      <li key={i} className="opacity-70">- {err}</li>
                    ))}
                  </ul>
                )}
                {revertResult.success && (
                  <p className="text-xs mt-2 opacity-60">Returning to history list...</p>
                )}
              </div>
              <button
                onClick={dismissResult}
                className="shrink-0 text-sm opacity-60 hover:opacity-100 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <hr className="border-border my-5" />

        <div className="flex flex-col gap-6">
          <section>
            <h3 className="text-sm font-semibold text-text mb-2">Original Brud Prompt</h3>
            <pre className="text-sm text-text-secondary bg-surface-2 border border-border rounded-lg p-4 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono">
              {originalPrompt}
            </pre>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-text mb-3">Operations</h3>
            <div className="flex flex-col gap-2">
              {operations.length > 0 ? operations.map((op, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border bg-surface"
                >
                  <div className="shrink-0">{statusIcon(op.status)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium text-text">{formatKind(op.kind || '')}</span>
                      <span className="text-xs font-mono text-text-secondary">#{op.operationIndex}</span>
                    </div>
                    {op.path && (
                      <p className="text-xs text-text-secondary font-mono truncate">{op.path}</p>
                    )}
                    {op.message && (
                      <p className="text-xs text-text-secondary mt-0.5">{op.message}</p>
                    )}
                  </div>
                </div>
              )) : (
                <p className="text-sm text-text-secondary">
                  {operationCount > 0
                    ? `${operationCount} operation${operationCount !== 1 ? 's' : ''} of type${operationCount !== 1 ? 's' : ''}: ${operationTypes.join(', ')}`
                    : 'No operation details available.'}
                </p>
              )}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-text mb-2">Files Affected</h3>
            {filesAffected.length > 0 ? (
              <div className="border border-border rounded-lg divide-y divide-border">
                {filesAffected.map((file, i) => (
                  <div key={i} className="p-3">
                    <p className="text-sm font-mono text-text-secondary">{file}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-secondary">No files affected.</p>
            )}
          </section>

          <section>
            <h3 className="text-sm font-semibold text-text mb-2">Metadata</h3>
            <div className="border border-border rounded-lg bg-surface">
              <pre className="text-sm text-text-secondary p-4 overflow-x-auto font-mono whitespace-pre-wrap">
                {hasMetadata ? JSON.stringify(metadataUsed, null, 2) : 'No metadata recorded.'}
              </pre>
            </div>
          </section>
        </div>

        <ConfirmationModal
          isOpen={showConfirmModal}
          title="Confirm Revert"
          message="This will restore files to their pre-patch state. This action cannot be undone. Continue?"
          confirmLabel="Restore"
          cancelLabel="Cancel"
          onConfirm={handleConfirmRevert}
          onCancel={handleCancelRevert}
        />
      </div>
    );
  } catch (err) {
    return (
      <div className="flex-1 flex flex-col px-6 py-6 max-w-4xl mx-auto w-full">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-text-secondary hover:text-text mb-6 transition-colors cursor-pointer"
        >
          <ArrowLeft size={16} />
          Back to History
        </button>
        <div className="flex flex-col items-center justify-center py-12">
          <AlertCircle size={32} className="text-yellow-500 mb-4" />
          <h3 className="text-lg font-medium text-text mb-2">Unable to display session details</h3>
          <p className="text-sm text-text-secondary text-center max-w-md">
            An unexpected error occurred while rendering this session. The session data may be from an older version of Brud.
          </p>
        </div>
      </div>
    );
  }
}

function HistoryView() {
  const [sessions, setSessions] = useState<HistorySessionResult[]>([]);
  const [selectedSession, setSelectedSession] = useState<HistorySessionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showWipeModal, setShowWipeModal] = useState(false);

  useEffect(() => {
    setLoading(true);
    sendToExtension({ command: 'getHistory' });

    const unsubscribe = onExtensionMessage((message) => {
      if (message.command === 'historyResult' && message.history) {
        const sorted = [...message.history].sort(
          (a, b) => {
            const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return tb - ta;
          }
        );
        setSessions(sorted);
        setLoading(false);
      }
      if (message.command === 'historyWiped') {
        setSessions([]);
        setLoading(false);
        setShowWipeModal(false);
      }
    });

    return unsubscribe;
  }, [refreshKey]);

  const handleBack = useCallback(() => {
    setSelectedSession(null);
    setRefreshKey(k => k + 1);
  }, []);

  const grouped = groupByDate(sessions);

  if (selectedSession) {
    return <DetailView session={selectedSession} onBack={handleBack} />;
  }

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
        <div className="ml-auto">
          <button
            onClick={() => setShowWipeModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border border-red-500/60 text-red-600 bg-red-500/10 hover:bg-red-500/20 transition-colors cursor-pointer"
          >
            <AlertTriangle size={16} />
            Wipe Out History
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {Array.from(grouped.entries()).map(([dateHeader, dateSessions]) => (
          <div key={dateHeader}>
            <h3 className="text-sm font-medium text-text-secondary mb-3 sticky top-0 bg-surface py-1">
              {dateHeader}
            </h3>
            <div className="flex flex-col gap-2">
              {dateSessions.map((session) => {
                const sid = session.sessionId || 'Unknown';
                const sessionStatus = session.status || 'unknown';
                const sessionTimestamp = session.timestamp;
                const sessionPrompt = session.originalPrompt || 'No prompt recorded.';
                const sessionOpCount = session.operationCount || 0;
                const sessionFiles = session.filesAffected || [];
                return (
                  <button
                    key={sid}
                    onClick={() => setSelectedSession(session)}
                    className="flex items-start gap-3 p-4 rounded-lg border border-border bg-surface hover:bg-surface-2 hover:border-border-subtle text-left cursor-pointer transition-colors"
                  >
                    <div className="mt-0.5 shrink-0">
                      {sessionStatus === 'success' ? (
                        <CheckCircle size={18} className="text-green-500" />
                      ) : (
                        <XCircle size={18} className="text-red-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-sm font-mono font-medium text-text">
                          {sid}
                        </span>
                        <span className="text-xs text-text-secondary shrink-0">
                          {sessionTimestamp ? formatTime(sessionTimestamp) : '--:--'}
                        </span>
                      </div>
                      <p className="text-sm text-text-secondary line-clamp-1 mb-1.5">
                        {sessionPrompt.length > 50
                          ? sessionPrompt.slice(0, 50) + '...'
                          : sessionPrompt}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-text-secondary">
                        <span className="flex items-center gap-1">
                          <FileText size={12} />
                          {sessionOpCount} ops
                        </span>
                        <span className="flex items-center gap-1">
                          <FileText size={12} />
                          {sessionFiles.length} files
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

      <WipeConfirmationModal
        isOpen={showWipeModal}
        sessionCount={sessions.length}
        onConfirm={() => {
          sendToExtension({ command: 'wipeHistory' });
        }}
        onCancel={() => setShowWipeModal(false)}
      />
    </div>
  );
}

export default HistoryView;