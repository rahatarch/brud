function TypingIndicator() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-[3px]">
        <span className="typing-dot" style={{ animationDelay: '0ms' }} />
        <span className="typing-dot" style={{ animationDelay: '150ms' }} />
        <span className="typing-dot" style={{ animationDelay: '300ms' }} />
      </div>
      <span className="text-small text-text-secondary">Working...</span>
    </div>
  );
}

export default TypingIndicator;