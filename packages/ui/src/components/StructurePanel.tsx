import { useState, useEffect, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { sendToExtension } from '../bridge/vscodeBridge';

interface StructureData {
  json: string;
  directoryPath: string;
  depth: number;
  fileCount: number;
  directoryCount: number;
}

function StructurePanel() {
  const [structures, setStructures] = useState<StructureData[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    sendToExtension({ command: 'ready' });
  }, []);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const message = event.data;
      if (message.command === 'structureResult') {
        if (message.structures) {
          setStructures(message.structures);
        } else if (message.structure) {
          setStructures([message.structure]);
        }
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleCopy = useCallback(() => {
    if (structures.length === 0) return;
    const text = structures.map(s => {
      const summary = `Path: ${s.directoryPath} | Depth: ${s.depth === 0 ? 'unlimited' : s.depth} | Files: ${s.fileCount} | Dirs: ${s.directoryCount}`;
      const compactJson = JSON.stringify(JSON.parse(s.json));
      return `${summary}\n${compactJson}`;
    }).join('\n\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [structures]);

  if (structures.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-surface px-6 py-12">
        <h1 className="text-2xl font-semibold text-text mb-3">Structure Extraction Result</h1>
        <p className="text-sm text-text-secondary text-center max-w-md leading-relaxed">
          Extract and view directory structures from your project. Use an extract_structure operation to populate this view.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-surface">
      <div className="border-b border-border bg-surface-2 px-6 py-4 flex items-center justify-between shrink-0">
        <h1 className="text-xl font-semibold text-text">Structure Extraction Result</h1>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-border bg-surface hover:bg-surface-2 text-text-secondary hover:text-text transition-colors cursor-pointer"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copied!' : 'Copy All JSON'}
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {structures.map((s, index) => (
          <div key={index}>
            <div className="flex items-center gap-6 px-6 py-3 border-b border-border bg-surface-2 text-sm text-text-secondary">
              <span className="text-xs text-text-tertiary font-medium mr-1">#{index + 1}</span>
              <span>
                Path: <span className="text-text font-mono">{s.directoryPath}</span>
              </span>
              <span>
                Depth: <span className="text-text">{s.depth === 0 ? 'unlimited' : s.depth}</span>
              </span>
              <span>
                Files: <span className="text-text">{s.fileCount}</span>
              </span>
              <span>
                Dirs: <span className="text-text">{s.directoryCount}</span>
              </span>
            </div>

            <div className="p-6 border-b border-border">
              <pre className="text-xs text-text-secondary font-mono whitespace-pre leading-relaxed">
                {s.json}
              </pre>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default StructurePanel;