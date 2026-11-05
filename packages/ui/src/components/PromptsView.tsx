/**
 * Placeholder for the legacy prompt vault view.
 *
 * The prompt field helpers lived in `@brud/core`, which was quarantined to
 * `deprecated/` in Phase 11 (D-14/D-17/D-22). The view is
 * rebuilt in Phase 13; this stub preserves the route in the meantime.
 */
function PromptsView() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
      <p className="text-sm text-text-secondary">Prompt library moved to deprecated/.</p>
    </div>
  );
}

export default PromptsView;