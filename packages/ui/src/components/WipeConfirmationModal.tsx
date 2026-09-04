import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';

const REQUIRED_PHRASE = 'DELETE ALL HISTORY';

interface WipeConfirmationModalProps {
  isOpen: boolean;
  sessionCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function WipeConfirmationModal({
  isOpen,
  sessionCount,
  onConfirm,
  onCancel,
}: WipeConfirmationModalProps) {
  const [inputValue, setInputValue] = useState('');
  const isMatch = inputValue === REQUIRED_PHRASE;

  useEffect(() => {
    if (isOpen) {
      setInputValue('');
    }
  }, [isOpen]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    },
    [onCancel]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onCancel}
    >
      <div
        className="bg-surface border border-red-500/30 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-full bg-red-500/10">
            <AlertTriangle size={24} className="text-red-500" />
          </div>
          <h3 className="text-lg font-semibold text-text">Wipe Out History</h3>
        </div>

        <p className="text-sm text-text-secondary mb-2">
          This will permanently delete all Brud history. This action cannot be undone.
        </p>

        <p className="text-sm text-text-secondary mb-4">
          <span className="font-semibold text-red-500">{sessionCount}</span> session{sessionCount !== 1 ? 's' : ''} will be deleted.
        </p>

        <label className="block text-sm font-medium text-text-secondary mb-2">
          Type <span className="font-mono text-red-500 font-bold">{REQUIRED_PHRASE}</span> to confirm:
        </label>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder={REQUIRED_PHRASE}
          className="w-full px-3 py-2 rounded-lg border border-border bg-surface-2 text-text placeholder-text-secondary/50 focus:outline-none focus:border-red-500/50 text-sm font-mono"
          autoFocus
        />

        <div className="flex gap-3 justify-end mt-6">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-surface border border-border text-text-secondary hover:bg-surface-2 hover:text-text transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!isMatch}
            className={`px-4 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
              isMatch
                ? 'bg-red-600 text-white border border-red-700 hover:bg-red-500 font-semibold'
                : 'bg-red-600/30 text-red-300 border border-red-700/30 cursor-not-allowed'
            }`}
          >
            Delete All History
          </button>
        </div>
      </div>
    </div>
  );
}