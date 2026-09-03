import { useState } from 'react';
import { getAllPrompts, getPromptById } from '@brud/core';
import { Copy, Check, ArrowLeft, BookOpen } from 'lucide-react';
import CustomScrollbar from './CustomScrollbar';

function PromptLibrary() {
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);

  const prompts = getAllPrompts();

  const handleSelectPrompt = (id: string) => {
    setSelectedPromptId(id);
    setCopiedPromptId(null);
  };

  const handleBack = () => {
    setSelectedPromptId(null);
    setCopiedPromptId(null);
  };

  const handleCopy = async (id: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedPromptId(id);
      setTimeout(() => setCopiedPromptId(null), 2000);
    } catch {
      // Clipboard write failed
    }
  };

  if (selectedPromptId) {
    const prompt = getPromptById(selectedPromptId);
    if (!prompt) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
          <p className="text-sm text-text-secondary">Prompt not found.</p>
        </div>
      );
    }

    return (
      <div className="flex-1 flex flex-col px-6 py-6 max-w-4xl mx-auto w-full">
        <button
          onClick={handleBack}
          className="flex items-center gap-2 text-sm text-text-secondary hover:text-text mb-4 cursor-pointer self-start"
        >
          <ArrowLeft size={16} />
          Back to Library
        </button>

        <div className="flex items-center justify-between mb-2">
          <h2 className="text-2xl font-semibold text-text">{prompt.title}</h2>
          <button
            onClick={() => handleCopy(prompt.id, prompt.content)}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-md border border-border bg-surface hover:bg-surface-2 cursor-pointer text-text"
          >
            {copiedPromptId === prompt.id ? (
              <>
                <Check size={16} className="text-green-500" />
                Copied!
              </>
            ) : (
              <>
                <Copy size={16} />
                Copy
              </>
            )}
          </button>
        </div>

        <p className="text-sm text-text-secondary mb-4">{prompt.description}</p>

        <CustomScrollbar className="flex-1 bg-surface-2 border border-border rounded-lg p-4 max-h-[60vh]">
          <pre className="text-sm text-text-secondary font-mono whitespace-pre-wrap wrap-break-words">
            {prompt.content}
          </pre>
        </CustomScrollbar>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col px-6 py-6 max-w-4xl mx-auto w-full">
      <div className="flex items-center gap-3 mb-2">
        <BookOpen size={24} className="text-text" />
        <h2 className="text-2xl font-semibold text-text">Prompt Library</h2>
      </div>
      <p className="text-sm text-text-secondary mb-6 max-w-md">
        Browse and manage your saved Brud prompts. Select a prompt to view its full content and copy it to your clipboard.
      </p>

      {prompts.length === 0 ? (
        <p className="text-sm text-text-secondary">No prompts available.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {prompts.map((prompt) => (
            <button
              key={prompt.id}
              onClick={() => handleSelectPrompt(prompt.id)}
              className="bg-surface border border-border rounded-lg p-4 cursor-pointer text-left hover:border-primary transition-colors"
            >
              <h3 className="text-base font-medium text-text mb-1">{prompt.title}</h3>
              <p className="text-sm text-text-secondary">{prompt.description}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default PromptLibrary;