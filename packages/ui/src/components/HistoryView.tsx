import { useState, useEffect, useCallback } from 'react';
import { History, CheckCircle, XCircle, AlertCircle, Clock, FileText, ArrowLeft, Loader2, AlertTriangle, Trash2, Square, CheckSquare, X, Download } from 'lucide-react';
import type { HistorySessionResult, RevertSessionResult, RevertHistoryData, SessionSnapshotsResult } from '@brud/protocol';
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

function DetailView({ session, onBack, onViewRevertHistory }: { session: HistorySessionResult; onBack: () => void; onViewRevertHistory: () => void }) {
  const sessionId = session.sessionId || 'Unknown Session';
  const timestamp = session.timestamp;
  const status = session.status || 'unknown';
  const originalPrompt = session.originalPrompt || 'No prompt recorded.';
  const operations = session.operations || [];
  const operationCount = session.operationCount || 0;
  const operationTypes = session.operationTypes || [];
  const metadataUsed = session.metadataUsed || {};
  const hasMetadata = Object.keys(metadataUsed).length > 0;
  const [revertLoading, setRevertLoading] = useState<'pre' | 'post' | null>(null);
  const [revertResult, setRevertResult] = useState<RevertSessionResult | null>(null);
  const [revertDismissed, setRevertDismissed] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingTargetState, setPendingTargetState] = useState<'pre' | 'post' | null>(null);
  const [revertHistory, setRevertHistory] = useState<RevertHistoryData[] | null>(null);
  const [revertHistoryLoading, setRevertHistoryLoading] = useState(false);
  const NON_REVERTABLE_KINDS = new Set(['extract_structure', 'codebase_metadata']);

  const [selectedOperationIds, setSelectedOperationIds] = useState<Set<string>>(new Set());
  const [showIndividualRevertModal, setShowIndividualRevertModal] = useState(false);
  const [pendingIndividualTarget, setPendingIndividualTarget] = useState<'pre' | 'post' | null>(null);
  const [individualRevertResult, setIndividualRevertResult] = useState<RevertSessionResult | null>(null);
  const [individualRevertLoading, setIndividualRevertLoading] = useState(false);
  const [exportCopied, setExportCopied] = useState(false);
  const [snapshotData, setSnapshotData] = useState<SessionSnapshotsResult | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  const toggleOperation = useCallback((operationId: string) => {
    setSelectedOperationIds(prev => {
      const next = new Set(prev);
      if (next.has(operationId)) {
        next.delete(operationId);
      } else {
        next.add(operationId);
      }
      return next;
    });
  }, []);

  const hasSelectedOperations = selectedOperationIds.size > 0;

  useEffect(() => {
    setRevertHistory(null);
    setRevertHistoryLoading(true);
    sendToExtension({ command: 'getRevertHistory', sessionId });

    const unsubscribe = onExtensionMessage((message) => {
      if (message.command === 'revertHistoryResult' && message.revertHistory) {
        setRevertHistory(message.revertHistory);
        setRevertHistoryLoading(false);
      }
      if (message.command === 'revertResult' && message.revertResult) {
        setRevertResult(message.revertResult);
        setRevertLoading(null);
        if (message.revertResult.success) {
          setRevertHistory(null);
          setRevertHistoryLoading(true);
          sendToExtension({ command: 'getRevertHistory', sessionId });
          setTimeout(() => {
            onBack();
          }, 2000);
        }
      }
      if (message.command === 'revertOperationsResult' && message.revertOperationsResult) {
        setIndividualRevertResult(message.revertOperationsResult);
        setIndividualRevertLoading(false);
        if (message.revertOperationsResult.success) {
          setSelectedOperationIds(new Set());
          setRevertHistory(null);
          setRevertHistoryLoading(true);
          sendToExtension({ command: 'getRevertHistory', sessionId });
        }
      }
    });
    return unsubscribe;
  }, [sessionId, onBack]);

  useEffect(() => {
    setSnapshotData(null);
    setSnapshotLoading(true);
    sendToExtension({ command: 'getSessionSnapshots', sessionId });

    const unsubscribe = onExtensionMessage((message) => {
      if (message.command === 'sessionSnapshotsResult') {
        setSnapshotData(message.snapshotData);
        setSnapshotLoading(false);
      }
    });
    return unsubscribe;
  }, [sessionId]);

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

  const handleIndividualRevert = useCallback((targetState: 'pre' | 'post') => {
    setPendingIndividualTarget(targetState);
    setShowIndividualRevertModal(true);
  }, []);

  const handleConfirmIndividualRevert = useCallback(() => {
    if (!pendingIndividualTarget || selectedOperationIds.size === 0) return;
    setShowIndividualRevertModal(false);
    setIndividualRevertLoading(true);
    setIndividualRevertResult(null);
    sendToExtension({
      command: 'revertOperations',
      sessionId,
      targetState: pendingIndividualTarget,
      operationIds: Array.from(selectedOperationIds),
    });
    setPendingIndividualTarget(null);
  }, [pendingIndividualTarget, selectedOperationIds, sessionId]);

  const handleCancelIndividualRevert = useCallback(() => {
    setShowIndividualRevertModal(false);
    setPendingIndividualTarget(null);
  }, []);

  const dismissResult = useCallback(() => {
    setRevertResult(null);
    setRevertDismissed(true);
  }, []);

  const dismissIndividualResult = useCallback(() => {
    setIndividualRevertResult(null);
  }, []);

  const handleExportJSON = useCallback(() => {
    const preSnapshot = snapshotData?.pre;
    const postSnapshot = snapshotData?.post;

    const exportData = {
      session: {
        sessionId: session.sessionId,
        timestamp: session.timestamp,
        status: session.status,
        operationCount: session.operationCount,
        operationTypes: session.operationTypes,
        terminalCommands: session.terminalCommands,
        revertCommands: session.revertCommands,
        isDeleted: session.isDeleted,
        deletedAt: session.deletedAt,
        expiresAt: session.expiresAt,
        deletedBy: session.deletedBy,
        deleteReason: session.deleteReason,
        renewedAt: session.renewedAt,
      },
      originalPrompt: session.originalPrompt,
      operations: session.operations,
      filesAffected: session.filesAffected,
      metadata: session.metadataUsed,
      snapshots: {
        pre: preSnapshot ? {
          sessionId: preSnapshot.sessionId,
          snapshotType: preSnapshot.snapshotType,
          files: preSnapshot.files,
          diffFromPrevious: preSnapshot.diffFromPrevious,
        } : null,
        post: postSnapshot ? {
          sessionId: postSnapshot.sessionId,
          snapshotType: postSnapshot.snapshotType,
          files: postSnapshot.files,
          diffFromPrevious: postSnapshot.diffFromPrevious,
        } : null,
      },
      revertHistory: revertHistory || [],
      softDeleteHistory: session.softDeleteHistory || [],
    };

    navigator.clipboard.writeText(JSON.stringify(exportData, null, 2)).then(() => {
      setExportCopied(true);
      setTimeout(() => setExportCopied(false), 2000);
    });
  }, [session, snapshotData, revertHistory]);

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
          <button
            onClick={onViewRevertHistory}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-border bg-surface text-text-secondary hover:bg-surface-2 hover:text-text transition-colors cursor-pointer"
          >
            <History size={16} />
            View Revert History ({revertHistory ? revertHistory.length : 0})
          </button>
          <button
            onClick={handleExportJSON}
            disabled={snapshotLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-border bg-surface text-text-secondary hover:bg-surface-2 hover:text-text transition-colors cursor-pointer disabled:opacity-50"
          >
            <Download size={16} />
            {exportCopied ? 'Copied!' : 'Export to JSON'}
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

        {individualRevertResult && (
          <div className={`mt-4 p-4 rounded-lg border ${
            individualRevertResult.success
              ? 'bg-green-500/10 border-green-500/30 text-green-500'
              : 'bg-red-500/10 border-red-500/30 text-red-500'
          }`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <p className="text-sm font-medium">
                  {individualRevertResult.success ? 'Individual Revert Successful' : 'Individual Revert Failed'}
                </p>
                <p className="text-sm mt-1 opacity-80">{individualRevertResult.message}</p>
                {individualRevertResult.errors.length > 0 && (
                  <ul className="mt-2 text-xs space-y-1">
                    {individualRevertResult.errors.map((err, i) => (
                      <li key={i} className="opacity-70">- {err}</li>
                    ))}
                  </ul>
                )}
              </div>
              <button
                onClick={dismissIndividualResult}
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
            <h3 className="text-sm font-semibold text-text mb-2">Operations</h3>
            {operations.length > 0 ? (
              <div className="border border-border rounded-lg divide-y divide-border">
                {operations.map((op, i) => {
                  const isNonRevertable = NON_REVERTABLE_KINDS.has(op.kind);
                  const isChecked = selectedOperationIds.has(op.operationId);
                  return (
                    <div key={op.operationId || i} className="p-3 flex items-center gap-3">
                      {isNonRevertable ? (
                        <div className="shrink-0 text-text-secondary opacity-40" title="This operation cannot be reverted">
                          <Square size={18} />
                        </div>
                      ) : (
                        <button
                          onClick={() => toggleOperation(op.operationId)}
                          className="shrink-0 text-text-secondary hover:text-text transition-colors cursor-pointer"
                        >
                          {isChecked ? <CheckSquare size={18} /> : <Square size={18} />}
                        </button>
                      )}
                      <div className="shrink-0">{statusIcon(op.status)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-medium text-text">{formatKind(op.kind || '')}</span>
                          <span className="text-xs font-mono text-text-secondary">#{op.operationIndex}</span>
                          {op.operationId && (
                            <span className="text-xs font-mono text-text-secondary opacity-60">{op.operationId}</span>
                          )}
                        </div>
                        {op.path && (
                          <p className="text-xs text-text-secondary font-mono truncate">{op.path}</p>
                        )}
                        {op.message && (
                          <p className="text-xs text-text-secondary mt-0.5">{op.message}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-text-secondary">
                {operationCount > 0
                  ? `${operationCount} operation${operationCount !== 1 ? 's' : ''} of type${operationCount !== 1 ? 's' : ''}: ${operationTypes.join(', ')}`
                  : 'No operation details available.'}
              </p>
            )}
            {hasSelectedOperations && !individualRevertLoading && (
              <div className="flex items-center gap-2 mt-3">
                <span className="text-xs text-text-secondary">{selectedOperationIds.size} operation(s) selected</span>
                <button
                  onClick={() => handleIndividualRevert('pre')}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors cursor-pointer"
                >
                  Revert Selected to Pre-Patch
                </button>
                <button
                  onClick={() => handleIndividualRevert('post')}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-surface text-text-secondary hover:bg-surface-2 hover:text-text transition-colors cursor-pointer"
                >
                  Revert Selected to Post-Patch
                </button>
              </div>
            )}
            {individualRevertLoading && (
              <div className="flex items-center gap-2 mt-3 text-sm text-text-secondary">
                <Loader2 size={14} className="animate-spin" />
                Reverting selected operations...
              </div>
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
          message="This will restore all files to their pre-patch state. This action cannot be undone. Continue?"
          confirmLabel="Restore"
          cancelLabel="Cancel"
          onConfirm={handleConfirmRevert}
          onCancel={handleCancelRevert}
        />

        <ConfirmationModal
          isOpen={showIndividualRevertModal}
          title="Confirm Individual Revert"
          message={`This will revert ${selectedOperationIds.size} operation(s) to ${pendingIndividualTarget === 'pre' ? 'pre-patch' : 'post-patch'} state. This action cannot be undone. Continue?`}
          confirmLabel="Revert Selected"
          cancelLabel="Cancel"
          onConfirm={handleConfirmIndividualRevert}
          onCancel={handleCancelIndividualRevert}
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

function RevertHistoryPage({
  session,
  revertHistory,
  revertHistoryLoading,
  onBack,
  onViewRevertDetail,
}: {
  session: HistorySessionResult;
  revertHistory: RevertHistoryData[] | null;
  revertHistoryLoading: boolean;
  onBack: () => void;
  onViewRevertDetail: (revert: RevertHistoryData) => void;
}) {
  const REVERTS_PER_PAGE = 10;
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.ceil((revertHistory?.length || 0) / REVERTS_PER_PAGE);
  const startIndex = (currentPage - 1) * REVERTS_PER_PAGE;
  const endIndex = startIndex + REVERTS_PER_PAGE;
  const visibleReverts = (revertHistory || []).slice(startIndex, endIndex);

  useEffect(() => {
    setCurrentPage(1);
  }, [session.sessionId]);

  return (
    <div className="flex-1 flex flex-col px-6 py-6 max-w-4xl mx-auto w-full">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-text-secondary hover:text-text mb-6 transition-colors cursor-pointer"
      >
        <ArrowLeft size={16} />
        Back to Session Detail
      </button>

      <h2 className="text-xl font-semibold text-text font-mono mb-1">{session.sessionId}</h2>
      <p className="text-sm text-text-secondary mb-6">Revert History</p>

      {revertHistoryLoading ? (
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <Loader2 size={14} className="animate-spin" />
          Loading revert history...
        </div>
      ) : visibleReverts.length > 0 ? (
        <>
          <div className="flex flex-col gap-2 mb-6">
            {visibleReverts.map((revert) => (
              <button
                key={revert.revertId}
                onClick={() => onViewRevertDetail(revert)}
                className="flex items-start gap-3 p-3 rounded-lg border border-border bg-surface hover:bg-surface-2 hover:border-border-subtle text-left cursor-pointer transition-colors"
              >
                <div className="shrink-0 mt-0.5">
                  {revert.status === 'success' ? (
                    <CheckCircle size={18} className="text-green-500" />
                  ) : (
                    <XCircle size={18} className="text-red-500" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium text-text">
                      {revert.targetState === 'pre' ? 'Pre-Patch' : 'Post-Patch'}
                    </span>
                    <span className="text-xs text-text-secondary">
                      {formatFullDateTime(revert.timestamp)}
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary">
                    {revert.revertedOperationIds.length} operation{revert.revertedOperationIds.length !== 1 ? 's' : ''} reverted
                  </p>
                  {revert.errorMessage && (
                    <p className="text-xs text-red-500 mt-0.5">{revert.errorMessage}</p>
                  )}
                </div>
              </button>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-border bg-surface text-text-secondary hover:bg-surface-2 hover:text-text transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                Previous
              </button>
              <span className="text-sm text-text-secondary">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-border bg-surface text-text-secondary hover:bg-surface-2 hover:text-text transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                Next
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-text-secondary">No reverts recorded for this session.</p>
      )}
    </div>
  );
}

function RevertDetailView({
  session,
  revert,
  onBack,
}: {
  session: HistorySessionResult;
  revert: RevertHistoryData;
  onBack: () => void;
}) {
  const operations = session.operations || [];
  const revertedOperations = operations.filter((op) =>
    revert.revertedOperationIds.includes(op.operationId)
  );

  return (
    <div className="flex-1 flex flex-col px-6 py-6 max-w-4xl mx-auto w-full">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-text-secondary hover:text-text mb-6 transition-colors cursor-pointer"
      >
        <ArrowLeft size={16} />
        Back to Revert History
      </button>

      <h2 className="text-xl font-semibold text-text font-mono mb-1">{revert.revertId}</h2>
      <p className="text-sm text-text-secondary mb-6">{formatFullDateTime(revert.timestamp)}</p>

      <div className="flex items-center gap-3 mb-6">
        <span className="text-sm font-medium text-text">Target State:</span>
        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/30">
          {revert.targetState === 'pre' ? 'Pre-Patch' : 'Post-Patch'}
        </span>
        {statusBadge(revert.status)}
      </div>

      {revert.errorMessage && (
        <div className="mb-6 p-4 rounded-lg border bg-red-500/10 border-red-500/30 text-red-500">
          <p className="text-sm">{revert.errorMessage}</p>
        </div>
      )}

      <hr className="border-border mb-5" />

      <section>
        <h3 className="text-sm font-semibold text-text mb-3">
          Reverted Operations ({revertedOperations.length})
        </h3>
        {revertedOperations.length > 0 ? (
          <div className="border border-border rounded-lg divide-y divide-border">
            {revertedOperations.map((op, i) => (
              <div key={op.operationId || i} className="p-3 flex items-center gap-3">
                <div className="shrink-0">{statusIcon(op.status)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium text-text">{formatKind(op.kind || '')}</span>
                    <span className="text-xs font-mono text-text-secondary">#{op.operationIndex}</span>
                    {op.operationId && (
                      <span className="text-xs font-mono text-text-secondary opacity-60">{op.operationId}</span>
                    )}
                  </div>
                  {op.path && (
                    <p className="text-xs text-text-secondary font-mono truncate">{op.path}</p>
                  )}
                  {op.message && (
                    <p className="text-xs text-text-secondary mt-0.5">{op.message}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-text-secondary">
            No operation details found for this revert. Operation IDs may reference operations that have been cleaned up.
          </p>
        )}
      </section>
    </div>
  );
}

function formatDaysRemaining(expiresAt?: string): string {
  if (!expiresAt) return '';
  try {
    const now = new Date();
    const expiry = new Date(expiresAt);
    const diffMs = expiry.getTime() - now.getTime();
    if (diffMs <= 0) return 'Expired';
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (days > 0) return `${days}d ${hours}h remaining`;
    return `${hours}h remaining`;
  } catch {
    return '';
  }
}

function ScheduledDeletesModal({
  isOpen,
  trashedSessions,
  onRestore,
  onPermanentDelete,
  onClose,
  onRefresh,
}: {
  isOpen: boolean;
  trashedSessions: HistorySessionResult[];
  onRestore: (sessionId: string) => void;
  onPermanentDelete: (sessionId: string) => void;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      onRefresh();
    }
  }, [isOpen, onRefresh]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onClose]);

  const handleRestore = async (sessionId: string) => {
    setActionLoading(sessionId);
    onRestore(sessionId);
  };

  const handlePermanentDelete = async (sessionId: string) => {
    setActionLoading(sessionId);
    onPermanentDelete(sessionId);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border rounded-lg w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text">Scheduled Deletes</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-text-secondary hover:text-text hover:bg-surface-2 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {trashedSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Trash2 size={40} className="text-text-secondary mb-4 opacity-50" />
              <p className="text-sm text-text-secondary">No scheduled deletes</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {trashedSessions.map((session) => (
                <div
                  key={session.sessionId}
                  className="flex items-start gap-4 p-4 rounded-lg border border-border bg-surface"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-mono font-medium text-text">{session.sessionId}</span>
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-xs text-text-secondary">
                        Deleted: {formatFullDateTime(session.deletedAt)}
                      </p>
                      {session.expiresAt && (
                        <p className="text-xs text-text-secondary">
                          Permanent deletion: {formatFullDateTime(session.expiresAt)}
                        </p>
                      )}
                      {session.expiresAt && (
                        <p className="text-xs font-medium text-yellow-500">
                          {formatDaysRemaining(session.expiresAt)}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => handleRestore(session.sessionId)}
                      disabled={actionLoading === session.sessionId}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-green-500/10 text-green-500 border border-green-500/30 hover:bg-green-500/20 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {actionLoading === session.sessionId ? 'Restoring...' : 'Restore'}
                    </button>
                    <button
                      onClick={() => handlePermanentDelete(session.sessionId)}
                      disabled={actionLoading === session.sessionId}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500/20 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {actionLoading === session.sessionId ? 'Deleting...' : 'Delete Permanently'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HistoryView() {
  const [sessions, setSessions] = useState<HistorySessionResult[]>([]);
  const [trashedSessions, setTrashedSessions] = useState<HistorySessionResult[]>([]);
  const [selectedSession, setSelectedSession] = useState<HistorySessionResult | null>(null);
  const [viewState, setViewState] = useState<'list' | 'detail' | 'reverts' | 'revertDetail'>('list');
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showWipeModal, setShowWipeModal] = useState(false);
  const [showScheduledDeletes, setShowScheduledDeletes] = useState(false);
  const [revertHistory, setRevertHistory] = useState<RevertHistoryData[] | null>(null);
  const [revertHistoryLoading, setRevertHistoryLoading] = useState(false);
  const [selectedRevert, setSelectedRevert] = useState<RevertHistoryData | null>(null);
  const [sessionToDelete, setSessionToDelete] = useState<HistorySessionResult | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [protectionEnabled, setProtectionEnabled] = useState(true);

  useEffect(() => {
    setLoading(true);
    sendToExtension({ command: 'getHistory' });
    sendToExtension({ command: 'getTrashedSessions' });

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
      if (message.command === 'trashedSessionsResult' && message.trashedSessions) {
        setTrashedSessions(message.trashedSessions);
      }
      if (message.command === 'historyWiped') {
        setSessions([]);
        setLoading(false);
        setShowWipeModal(false);
      }
      if (message.command === 'sessionDeleted') {
        setRefreshKey(k => k + 1);
        setSessionToDelete(null);
        setDeleteLoading(false);
      }
      if (message.command === 'sessionRestored') {
        setRefreshKey(k => k + 1);
      }
      if (message.command === 'revertHistoryResult' && message.revertHistory) {
        setRevertHistory(message.revertHistory);
        setRevertHistoryLoading(false);
      }
    });

    return unsubscribe;
  }, [refreshKey]);

  const handleBackToDetail = useCallback(() => {
    setViewState('detail');
  }, []);

  const handleBackToList = useCallback(() => {
    setSelectedSession(null);
    setViewState('list');
    setRefreshKey(k => k + 1);
  }, []);

  const handleViewRevertHistory = useCallback(() => {
    setRevertHistoryLoading(true);
    setRevertHistory(null);
    if (selectedSession) {
      sendToExtension({ command: 'getRevertHistory', sessionId: selectedSession.sessionId });
    }
    setViewState('reverts');
  }, [selectedSession]);

  const handleViewRevertDetail = useCallback((revert: RevertHistoryData) => {
    setSelectedRevert(revert);
    setViewState('revertDetail');
  }, []);

  const handleBackToRevertHistory = useCallback(() => {
    setSelectedRevert(null);
    setViewState('reverts');
  }, []);

  const handleSelectSession = useCallback((session: HistorySessionResult) => {
    setSelectedSession(session);
    setViewState('detail');
  }, []);

  const handleDeleteSession = useCallback((e: React.MouseEvent, session: HistorySessionResult) => {
    e.stopPropagation();
    setSessionToDelete(session);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (!sessionToDelete) return;
    setDeleteLoading(true);
    if (protectionEnabled) {
      sendToExtension({
        command: 'softDeleteSession',
        sessionId: sessionToDelete.sessionId,
        triggeredBy: 'user',
      });
    } else {
      sendToExtension({
        command: 'deleteSingleSession',
        sessionId: sessionToDelete.sessionId,
        triggeredBy: 'user',
        permanentDelete: true,
      });
    }
  }, [sessionToDelete, protectionEnabled]);

  const handleWipeConfirm = useCallback((permanentDelete: boolean) => {
    sendToExtension({ command: 'wipeHistory', permanentDelete });
  }, []);

  const handleCancelDelete = useCallback(() => {
    setSessionToDelete(null);
  }, []);

  const handleRestoreSession = useCallback((sessionId: string) => {
    sendToExtension({ command: 'restoreSession', sessionId });
  }, []);

  const handlePermanentDeleteSession = useCallback((sessionId: string) => {
    sendToExtension({ command: 'permanentDelete', sessionId });
  }, []);

  const handleRefreshTrash = useCallback(() => {
    sendToExtension({ command: 'getTrashedSessions' });
  }, []);

  const grouped = groupByDate(sessions);

  if (viewState === 'revertDetail' && selectedSession && selectedRevert) {
    return (
      <RevertDetailView
        session={selectedSession}
        revert={selectedRevert}
        onBack={handleBackToRevertHistory}
      />
    );
  }

  if (viewState === 'reverts' && selectedSession) {
    return (
      <RevertHistoryPage
        session={selectedSession}
        revertHistory={revertHistory}
        revertHistoryLoading={revertHistoryLoading}
        onBack={handleBackToDetail}
        onViewRevertDetail={handleViewRevertDetail}
      />
    );
  }

  if (viewState === 'detail' && selectedSession) {
    return <DetailView session={selectedSession} onBack={handleBackToList} onViewRevertHistory={handleViewRevertHistory} />;
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
        <p className="text-sm text-text-secondary text-center max-w-sm mb-6">
          Brud sessions will appear here once you start using Brud in this workspace.
        </p>
        {trashedSessions.length > 0 && (
          <button
            onClick={() => setShowScheduledDeletes(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border border-border bg-surface text-text-secondary hover:bg-surface-2 hover:text-text transition-colors cursor-pointer"
          >
            <Trash2 size={16} />
            Scheduled Deletes ({trashedSessions.length})
          </button>
        )}
        <ScheduledDeletesModal
          isOpen={showScheduledDeletes}
          trashedSessions={trashedSessions}
          onRestore={handleRestoreSession}
          onPermanentDelete={handlePermanentDeleteSession}
          onClose={() => setShowScheduledDeletes(false)}
          onRefresh={handleRefreshTrash}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col px-6 py-6 max-w-4xl mx-auto w-full">
      <div className="flex items-center gap-3 mb-6">
        <History size={24} className="text-text" />
        <h2 className="text-2xl font-semibold text-text">History</h2>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowScheduledDeletes(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border border-border bg-surface text-text-secondary hover:bg-surface-2 hover:text-text transition-colors cursor-pointer"
          >
            <Trash2 size={16} />
            Scheduled Deletes{trashedSessions.length > 0 && ` (${trashedSessions.length})`}
          </button>
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
                    onClick={() => handleSelectSession(session)}
                    className="flex items-start gap-3 p-4 rounded-lg border border-border bg-surface hover:bg-surface-2 hover:border-border-subtle text-left cursor-pointer transition-colors group"
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
                    <button
                      onClick={(e) => handleDeleteSession(e, session)}
                      className="shrink-0 p-1.5 rounded-md text-text-secondary opacity-0 group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-500 transition-all cursor-pointer"
                      title="Delete session"
                    >
                      <Trash2 size={14} />
                    </button>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <ScheduledDeletesModal
        isOpen={showScheduledDeletes}
        trashedSessions={trashedSessions}
        onRestore={handleRestoreSession}
        onPermanentDelete={handlePermanentDeleteSession}
        onClose={() => setShowScheduledDeletes(false)}
        onRefresh={handleRefreshTrash}
      />

      <WipeConfirmationModal
        isOpen={showWipeModal}
        sessionCount={sessions.length}
        onConfirm={(permanentDelete) => {
          handleWipeConfirm(permanentDelete);
        }}
        onCancel={() => setShowWipeModal(false)}
      />

      <ConfirmationModal
        isOpen={sessionToDelete !== null}
        title="Delete Session"
        message={`Are you sure you want to delete session ${sessionToDelete?.sessionId || ''}?`}
        confirmLabel={deleteLoading ? 'Deleting...' : 'Delete'}
        cancelLabel="Cancel"
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      >
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={protectionEnabled}
            onChange={(e) => setProtectionEnabled(e.target.checked)}
            className="rounded border-border bg-surface-2 text-primary focus:ring-primary/30"
          />
          <span className="text-sm text-text-secondary">7-day protection (recoverable)</span>
        </label>
      </ConfirmationModal>
    </div>
  );
}

export default HistoryView;