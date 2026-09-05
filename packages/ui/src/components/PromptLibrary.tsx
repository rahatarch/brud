import { useState, useRef } from 'react';
import { getAllPrompts, getPromptById } from '@brud/core';
import { Copy, Check, ArrowLeft, BookOpen, ChevronLeft, ChevronRight } from 'lucide-react';

function PromptLibrary() {
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const detailViewRef = useRef<HTMLDivElement>(null);

  const PROMPTS_PER_PAGE = 10;
  const prompts = getAllPrompts();
  const totalPages = Math.ceil(prompts.length / PROMPTS_PER_PAGE);
  const startIndex = (currentPage - 1) * PROMPTS_PER_PAGE;
  const endIndex = startIndex + PROMPTS_PER_PAGE;
  const visiblePrompts = prompts.slice(startIndex, endIndex);

  const handleSelectPrompt = (id: string) => {
    setSelectedPromptId(id);
    setCopiedPromptId(null);
  };

  const handleBack = () => {
    setSelectedPromptId(null);
    setCopiedPromptId(null);
    setCurrentPage(1);
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
      <div ref={detailViewRef} className="min-h-0 flex-1 flex flex-col px-6 py-6 max-w-4xl mx-auto w-full">
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

        <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 border border-border rounded-lg p-4 max-h-[60vh]">
          <pre className="text-sm text-text-secondary font-mono whitespace-pre-wrap break-all">
            {prompt.content}
          </pre>
        </div>
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
        <>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {visiblePrompts.map((prompt) => (
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
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 mt-6">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-border bg-surface hover:bg-surface-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={16} />
                Previous
              </button>
              <span className="text-sm text-text-secondary">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-border bg-surface hover:bg-surface-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default PromptLibrary;