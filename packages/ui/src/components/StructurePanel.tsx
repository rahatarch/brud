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
  const [structureData, setStructureData] = useState<StructureData | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    sendToExtension({ command: 'ready' });
  }, []);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const message = event.data;
      if (message.command === 'structureResult' && message.structure) {
        setStructureData(message.structure);
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleCopy = useCallback(() => {
    if (!structureData) return;
    const summary = [
      `Path: ${structureData.directoryPath}`,
      `Depth: ${structureData.depth === 0 ? 'unlimited' : structureData.depth}`,
      `Files: ${structureData.fileCount}`,
      `Dirs: ${structureData.directoryCount}`,
    ].join('\n');
    navigator.clipboard.writeText(`${summary}\n\n${structureData.json}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [structureData]);

  if (!structureData) {
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
      <div className="border-b border-border bg-surface-2 px-6 py-4">
        <h1 className="text-xl font-semibold text-text">Structure Extraction Result</h1>
      </div>

      <div className="flex items-center gap-6 px-6 py-3 border-b border-border bg-surface-2 text-sm text-text-secondary">
        <span>
          Path: <span className="text-text font-mono">{structureData.directoryPath}</span>
        </span>
        <span>
          Depth: <span className="text-text">{structureData.depth === 0 ? 'unlimited' : structureData.depth}</span>
        </span>
        <span>
          Files: <span className="text-text">{structureData.fileCount}</span>
        </span>
        <span>
          Dirs: <span className="text-text">{structureData.directoryCount}</span>
        </span>
        <button
          onClick={handleCopy}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-border bg-surface hover:bg-surface-2 text-text-secondary hover:text-text transition-colors cursor-pointer"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copied!' : 'Copy JSON'}
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <pre className="text-xs text-text-secondary font-mono whitespace-pre leading-relaxed">
          {structureData.json}
        </pre>
      </div>
    </div>
  );
}

export default StructurePanel;