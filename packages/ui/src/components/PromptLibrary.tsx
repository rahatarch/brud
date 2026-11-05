/**
 * Placeholder for the legacy built-in prompt library.
 *
 * The prompt catalogue lived in `@brud/core`, which was quarantined to
 * `deprecated/` in Phase 11 (D-14/D-17/D-22). The library is
 * rebuilt in Phase 13; this stub preserves the route in the meantime.
 */
function PromptLibrary() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
      <p className="text-sm text-text-secondary">Prompt library moved to deprecated/.</p>
    </div>
  );
}

export default PromptLibrary;