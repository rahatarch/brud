import { useState, useEffect, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { sendToExtension } from '../bridge/vscodeBridge';
import { globalRegistry } from '../result-registry/registry';

export interface UnifiedOperationResult {
  toolKind: string;
  data: any;
}

export interface UnifiedSessionResults {
  operations: UnifiedOperationResult[];
}

function UnifiedResultsPanel() {
  const [results, setResults] = useState<UnifiedSessionResults | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    sendToExtension({ command: 'ready' });
  }, []);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const message = event.data;
      if (message.command === 'unifiedResults' && message.results) {
        setResults(message.results);
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleCopyAll = useCallback(() => {
    if (!results) return;
    const parts: string[] = [];
    for (const op of results.operations) {
      const renderer = globalRegistry.getRenderer(op.toolKind);
      if (renderer) {
        const formatted = renderer.copyFormatter(op.data);
        if (formatted) {
          parts.push(`=== ${renderer.title} ===\n${formatted}`);
        }
      }
    }
    if (parts.length > 0) {
      navigator.clipboard.writeText(parts.join('\n\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [results]);

  if (!results || results.operations.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-surface px-6 py-12">
        <h1 className="text-2xl font-semibold text-text mb-3">Brud Session Results</h1>
        <p className="text-sm text-text-secondary text-center max-w-md leading-relaxed">
          Execute file operations to populate this view with results.
        </p>
      </div>
    );
  }

  const renderers = globalRegistry.getAllRenderers();
  const sections = results.operations.map(op => ({
    renderer: globalRegistry.getRenderer(op.toolKind),
    data: op.data
  })).filter(s => s.renderer);

  return (
    <div className="min-h-screen flex flex-col bg-surface">
      <div className="border-b border-border bg-surface-2 px-6 py-4 flex items-center justify-between shrink-0">
        <h1 className="text-xl font-semibold text-text">Brud Session Results</h1>
        <button
          onClick={handleCopyAll}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-border bg-surface hover:bg-surface-2 text-text-secondary hover:text-text transition-colors cursor-pointer"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copied!' : 'Copy All'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sections.map(({ renderer, data }, index) => (
          <div key={index}>
            <div className="sticky top-0 z-10 bg-surface-3 border-b border-border px-6 py-2">
              <h2 className="text-sm font-semibold text-text">{renderer.title}</h2>
            </div>
            {renderer.renderSection(data)}
          </div>
        ))}
      </div>
    </div>
  );
}

export default UnifiedResultsPanel;