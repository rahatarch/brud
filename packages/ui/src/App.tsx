import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { Send, PlusCircle, ExternalLink, Copy, Check, Eye } from 'lucide-react';
import { useChatStore } from './stores/chatStore';
import TypingIndicator from './components/TypingIndicator';
import MainWindowShell from './components/MainWindowShell';
import StructurePanel from './components/StructurePanel';
import ReadResultsPanel from './components/ReadResultsPanel';
import DiffPreviewPanel from './components/DiffPreviewPanel';
import UnifiedResultsPanel from './components/UnifiedResultsPanel';
import { initResultRegistry } from './result-registry/init';
import { sendToExtension, onExtensionMessage } from './bridge/vscodeBridge';

initResultRegistry();

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
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const { messages, sessionState, sendPrompt, addReport, resetSession } = useChatStore();
  const chatAreaRef = useRef<HTMLDivElement>(null);

  const handleCopyMessage = (messageId: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedMessageId(messageId);
    setTimeout(() => setCopiedMessageId(null), 2000);
  };

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
        addReport(message.message || '');
      } else if (message.command === 'error') {
        addReport('[Error] ' + (message.message || 'An error occurred.'));
      }
    });
  }, [addReport]);

  useLayoutEffect(() => {
    if (chatAreaRef.current) {
      chatAreaRef.current.scrollTo({
        top: chatAreaRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [messages, sessionState]);

  const handleReset = () => {
    resetSession();
  };

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
    <div className="min-h-screen flex flex-col">
      <div className="flex items-center justify-end px-4 py-2 border-b border-border bg-surface-2">
        <button
          onClick={handleOpenMainWindow}
          className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text cursor-pointer bg-surface-3 hover:bg-surface-3 border border-border-subtle rounded px-2.5 py-1.5 transition-colors"
          title="Open Brud Code Management"
        >
          <ExternalLink size={12} />
          Management
        </button>
      </div>
      <div ref={chatAreaRef} className="flex-1 overflow-y-auto px-4 py-4">
        {sessionState === 'idle' && messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-6">
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
                className="px-4 py-2 text-xs text-text-secondary hover:text-text cursor-pointer bg-surface border border-border rounded transition-colors"
              >
                Codebase Metadata
              </button>
              <button
                onClick={handlePromptLibrary}
                className="px-4 py-2 text-xs text-text-secondary hover:text-text cursor-pointer bg-surface border border-border rounded transition-colors"
              >
                Prompt Library
              </button>
            </div>
          </div>
        ) : messages.length > 0 ? (
          <div className="flex flex-col gap-3">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.type === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[90%] rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap break-words ${
                    msg.type === 'user'
                      ? 'bg-surface-2 border border-border text-text'
                      : 'bg-surface-3 border border-border-subtle text-text'
                  }`}
                >
                  {msg.content}
                </div>
                {msg.type === 'brud' && (
                  <button
                    onClick={() => handleCopyMessage(msg.id, msg.content)}
                    className="ml-1 mt-1 text-text-muted hover:text-text transition-colors cursor-pointer"
                    title="Copy message"
                  >
                    {copiedMessageId === msg.id ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                )}
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

      <div className="pt-4 px-4 pb-2">
        {sessionState === 'complete' ? (
          <button
            onClick={handleReset}
            className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover active:bg-primary-active text-white rounded-lg px-4 py-3 cursor-pointer text-sm font-medium"
          >
            <PlusCircle size={16} />
            Create New Brud Code Session
          </button>
        ) : (
          <div className="bg-surface-2 border border-border rounded-md">
            <textarea
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Paste your Brud Prompt here..."
              className="w-full min-h-[100px] rounded-t-md bg-surface-2 p-4 resize-none text-text font-sans placeholder:text-text-muted outline-none text-sm"
            />
            <div className="flex items-center justify-end gap-1 px-2 py-1.5 bg-surface-2 rounded-b-md">
              <button
                onClick={handlePreview}
                className="flex items-center justify-center w-8 h-8 text-text-muted hover:text-text hover:brightness-125 cursor-pointer rounded transition-all"
                title="Preview Diff"
              >
                <Eye size={16} />
              </button>
              <button
                onClick={handleSend}
                className="flex items-center justify-center w-8 h-8 text-text-muted hover:text-text hover:brightness-125 cursor-pointer rounded transition-all"
                title="Execute"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;