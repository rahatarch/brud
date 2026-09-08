import { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import { Send, ExternalLink, Copy, Check, Eye, ChevronRight, AlertCircle, CheckCircle, XCircle, Trash2, Star } from 'lucide-react';
import { useChatStore } from './stores/chatStore';
import TypingIndicator from './components/TypingIndicator';
import MainWindowShell from './components/MainWindowShell';
import StructurePanel from './components/StructurePanel';
import ReadResultsPanel from './components/ReadResultsPanel';
import DiffPreviewPanel from './components/DiffPreviewPanel';
import UnifiedResultsPanel from './components/UnifiedResultsPanel';
import { initResultRegistry } from './result-registry/init';
import { sendToExtension, onExtensionMessage } from './bridge/vscodeBridge';
import type { ReportSection } from '@brud/protocol';

initResultRegistry();

function StatusBadge({ status }: { status: 'success' | 'failed' | 'aborted' }) {
  const colors: Record<string, string> = {
    success: 'bg-green-500/10 text-green-400 border-green-500/30',
    failed: 'bg-red-500/10 text-red-400 border-red-500/30',
    aborted: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
  };
  const icons: Record<string, any> = {
    success: <CheckCircle size={12} />,
    failed: <XCircle size={12} />,
    aborted: <AlertCircle size={12} />,
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border break-words ${colors[status]}`}>
      {icons[status]} {status}
    </span>
  );
}

function StructuredReport({ sections }: { sections: ReportSection[] }) {
  const [copiedIndex, setCopiedIndex] = useState<string | null>(null);

  const handleCopyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(key);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="flex flex-col gap-3 mt-2 overflow-x-hidden break-words">
      {sections.map((section, i) => {
        switch (section.type) {
          case 'summary':
            return (
              <div key={i}>
                {section.title && <div className="text-xs font-semibold text-text mb-2 uppercase tracking-wider">{section.title}</div>}
                <div className="flex flex-wrap gap-2">
                  {section.items?.map((item, j) => (
                    <div key={j} className="flex items-center gap-1.5 bg-surface-2 border border-border-subtle rounded px-2.5 py-1.5 text-xs max-w-full break-words">
                      {item.status ? <StatusBadge status={item.status} /> : null}
                      <span className="text-text-secondary shrink-0">{item.label}:</span>
                      <span className="text-text font-medium break-words">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          case 'table':
            return (
              <div key={i}>
                {section.title && <div className="text-xs font-semibold text-text mb-2 uppercase tracking-wider">{section.title}</div>}
                <div className="flex flex-col gap-1">
                  {section.items?.map((item, j) => (
                    <div key={j} className="flex items-start gap-2 bg-surface-2 border border-border-subtle rounded px-2.5 py-1.5 text-xs overflow-hidden">
                      <ChevronRight size={12} className="text-text-secondary shrink-0 mt-0.5" />
                      <span className="text-text-secondary shrink-0 min-w-[80px] break-words">{item.label}</span>
                      <span className="text-text flex-1 break-words min-w-0">{item.value}</span>
                      {item.status && <StatusBadge status={item.status} />}
                    </div>
                  ))}
                </div>
              </div>
            );
          case 'details':
            return (
              <div key={i}>
                {section.title && <div className="text-xs font-semibold text-text mb-2 uppercase tracking-wider">{section.title}</div>}
                {section.content && (
                  <pre className="text-xs text-red-400 bg-surface-2 border border-border-subtle rounded p-2 whitespace-pre-wrap overflow-x-auto max-h-[200px] overflow-y-auto break-words">
                    {section.content}
                  </pre>
                )}
              </div>
            );
          case 'text':
            return (
              <div key={i} className="text-sm text-text leading-relaxed">
                {section.content}
              </div>
            );
          case 'copyButton':
            return (
              <div key={i}>
                <button
                  onClick={() => handleCopyText(section.copyText || '', `copy-${i}`)}
                  className="flex items-center gap-1.5 text-xs text-primary hover:text-primary-hover cursor-pointer bg-surface-2 border border-border-subtle rounded px-3 py-2 transition-colors w-full text-left break-words"
                >
                  {copiedIndex === `copy-${i}` ? (
                    <><Check size={12} /> Copied!</>
                  ) : (
                    <><Copy size={12} /> {section.buttonText || 'Copy'}</>
                  )}
                </button>
              </div>
            );
          case 'button':
            return (
              <div key={i}>
                <button
                  onClick={() => sendToExtension({ command: section.buttonAction || 'openUnifiedResults' })}
                  className="flex items-center gap-1.5 text-xs text-primary hover:text-primary-hover cursor-pointer bg-surface-2 border border-border-subtle rounded px-3 py-2 transition-colors w-full text-left break-words"
                >
                  {section.buttonText || 'See Details'}
                  <ChevronRight size={12} />
                </button>
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

function App() {
  const root = document.getElementById('root');
  const viewMode = root?.getAttribute('data-view-mode') || 'sidebar';
  const imageUri = root?.getAttribute('data-image-uri') || 'images/brud_compressed_high.png';

  if (viewMode === 'main-window') {
    return <MainWindowShell />;
  }

  if (viewMode === 'structure-panel') {
    return <StructurePanel />;
  }

  if (viewMode === 'read-panel') {
    return <ReadResultsPanel />;
  }

  if (viewMode === 'diff-preview') {
    return <DiffPreviewPanel />;
  }

  if (viewMode === 'unified-results') {
    return <UnifiedResultsPanel />;
  }

  const [inputText, setInputText] = useState('');
  const { messages, sessionState, sendPrompt, addReport, resetSession } = useChatStore();
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  const handleScroll = useCallback(() => {
    const el = chatAreaRef.current;
    if (!el) return;
    const threshold = 80;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom < threshold;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = chatAreaRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  const handleSend = () => {
    if (!inputText.trim()) return;
    sendPrompt(inputText);
    sendToExtension({ command: 'applyPatch', text: inputText });
    setInputText('');
  };

  const handlePreview = () => {
    if (!inputText.trim()) return;
    sendToExtension({ command: 'previewPatch', text: inputText });
  };

  useEffect(() => {
    return onExtensionMessage((message) => {
      if (message.command === 'success') {
        addReport(message.message || '', message.structured);
      } else if (message.command === 'error') {
        addReport(message.message || 'An error occurred.', message.structured);
      } else if (message.command === 'previewNoChanges') {
        addReport(message.message || 'No changes found.', message.structured);
      }
    });
  }, [addReport]);

  useLayoutEffect(() => {
    if (!isNearBottomRef.current) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToBottom('auto');
      });
    });
  }, [messages, sessionState, scrollToBottom]);

  useLayoutEffect(() => {
    scrollToBottom('auto');
  }, [scrollToBottom]);

  const handleOpenMainWindow = () => {
    sendToExtension({ command: 'openMainWindow' });
  };

  const handleCodebaseMetadata = () => {
    sendToExtension({ command: 'applyPatch', text: '<<<<<<< CODEBASE_METADATA [1]\n>>>>>>> END CODEBASE_METADATA [1]' });
  };

  const handlePromptLibrary = () => {
    sendToExtension({ command: 'openMainWindow' });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 flex items-center justify-end gap-2 px-4 py-2 border-b border-border bg-surface-2">
        {messages.length > 0 && (
          <button
            onClick={resetSession}
            className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text cursor-pointer bg-surface-3 hover:bg-surface-3 border border-border-subtle rounded px-2.5 py-1.5 transition-colors"
            title="Clear Chat"
          >
            <Trash2 size={12} />
            Clear Chat
          </button>
        )}
        <button
          onClick={handleOpenMainWindow}
          className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text cursor-pointer bg-surface-3 hover:bg-surface-3 border border-border-subtle rounded px-2.5 py-1.5 transition-colors"
          title="Open Brud Code Management"
        >
          <ExternalLink size={12} />
          Management
        </button>
      </div>
      <div ref={chatAreaRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-4">
        {sessionState === 'idle' && messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center px-6 py-6">
            <img src={imageUri} alt="Brud Code Logo" className="w-[100px] h-[100px] mb-6 object-contain" />
            <h1 className="text-[24px] font-semibold text-text mb-3 text-center">
              Welcome to Brud Code
            </h1>
            <p className="text-[14px] text-text-secondary text-center max-w-[360px] leading-[1.5]">
              Brud Code is a full AI-assisted coding platform. Paste your Brud Prompt to
              control your codebase automatically.
            </p>
            <div className="flex flex-row items-center justify-center gap-3 mt-5">
              <button
                onClick={handleCodebaseMetadata}
                className="px-4 py-2 text-sm font-medium text-text bg-surface-3 rounded-md hover:text-primary hover:brightness-110 transition-all cursor-pointer"
              >
                Codebase Metadata
              </button>
              <button
                onClick={handlePromptLibrary}
                className="px-4 py-2 text-sm font-medium text-text bg-surface-3 rounded-md hover:text-primary hover:brightness-110 transition-all cursor-pointer"
              >
                Prompt Library
              </button>
            </div>
            <a
              href="https://github.com/rahatarch/brud"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary bg-primary/20 rounded-md hover:brightness-110 transition-all"
            >
              <Star size={16} />
              Star The Repo
            </a>
          </div>
        ) : messages.length > 0 ? (
          <div className="flex flex-col gap-3">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.type === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap break-words ${
                    msg.type === 'user'
                      ? 'max-w-[90%] bg-surface-2 border border-border text-text'
                      : 'text-text max-w-full'
                  }`}
                >
                  {msg.structured && msg.structured.length > 0 ? (
                    <StructuredReport sections={msg.structured} />
                  ) : (
                    <p>{msg.content}</p>
                  )}
                </div>
              </div>
            ))}
            {sessionState === 'working' && (
              <div className="flex justify-start">
                <TypingIndicator />
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div className="shrink-0 pt-4 px-4 pb-2">
        <div className="bg-surface-2 border border-border rounded-md">
          <textarea
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Paste your Brud Prompt here..."
            className="w-full min-h-[60px] rounded-t-md bg-surface-2 p-4 resize-none text-text font-sans placeholder:text-text-muted outline-none text-sm"
          />
          <div className="flex items-center justify-end gap-2 px-2 mb-2 bg-surface-2 rounded-b-md">
            <button
              onClick={handlePreview}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-text bg-surface-3 rounded-md hover:text-primary hover:brightness-110 transition-all cursor-pointer"
              title="Preview Diff"
            >
              <Eye size={16} />
              <span>Preview</span>
            </button>
            <button
              onClick={handleSend}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-text bg-surface-3 rounded-md hover:text-primary hover:brightness-110 transition-all cursor-pointer"
              title="Execute"
            >
              <Send size={16} />
              <span>Execute</span>
            </button>
          </div>
        </div>
        <div className="flex items-center justify-center gap-1.5 mt-2 text-[11px] text-text-secondary">
          <span>Brud Code by Rahat Hasan</span>
          <span className="text-border">|</span>
          <span>© 2026 Akkhar-Labs</span>
        </div>
      </div>
    </div>
  );
}

export default App;