import { useState, useEffect } from 'react';
import { Send, PlusCircle } from 'lucide-react';
import { useChatStore } from './stores/chatStore';
import TypingIndicator from './components/TypingIndicator';
import { sendToExtension, onExtensionMessage } from './bridge/vscodeBridge';

function App() {
  const imageUri = document.getElementById('root')?.getAttribute('data-image-uri') || 'images/brud_compressed_high.png';
  const [inputText, setInputText] = useState('');
  const { messages, sessionState, sendPrompt, addReport, resetSession } = useChatStore();

  const handleSend = () => {
    if (!inputText.trim()) return;
    sendPrompt(inputText);
    sendToExtension({ command: 'applyPatch', text: inputText });
    setInputText('');
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

  const handleReset = () => {
    resetSession();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {sessionState === 'idle' && messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center px-6 py-6">
            <img src={imageUri} alt="Brud Logo" className="w-[100px] h-[100px] mb-6 object-contain" />
            <h1 className="text-[24px] font-semibold text-text mb-3 text-center">
              Welcome to Brud
            </h1>
            <p className="text-[14px] text-text-secondary text-center max-w-[360px] leading-[1.5]">
              Brud is a full AI-assisted coding platform. Paste your Brud Prompt to
              control your codebase automatically.
            </p>
          </div>
        ) : messages.length > 0 ? (
          <div className="max-w-[80%] mx-auto flex flex-col gap-3">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap ${
                    msg.type === 'user'
                      ? 'bg-surface-2 border border-border text-text'
                      : 'bg-surface-3 border border-border-subtle text-text'
                  }`}
                >
                  {msg.content}
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

      <div className="p-4">
        {sessionState === 'complete' ? (
          <button
            onClick={handleReset}
            className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover active:bg-primary-active text-white rounded-lg px-4 py-3 cursor-pointer text-sm font-medium"
          >
            <PlusCircle size={16} />
            Create New Brud Session
          </button>
        ) : (
          <div className="relative">
            <textarea
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Paste your Brud Prompt here..."
              className="w-full min-h-[100px] rounded-md bg-surface-2 border border-border p-4 resize-none text-text font-sans placeholder:text-text-muted outline-none focus:border-primary text-sm"
            />
            <button
              onClick={handleSend}
              className="absolute bottom-4 right-3 bg-primary hover:bg-primary-hover active:bg-primary-active text-white w-9 h-9 rounded-md flex items-center justify-center cursor-pointer"
            >
              <Send size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;