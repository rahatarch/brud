// Features section copy, drawn from PROJECT.md sections 3, 5, 6 and 14.
// Numbers and names here are facts: do not round or reword them.

export const FEATURES = {
  title: "Everything vibe coding gets wrong, fixed",
  lede: "Every AI IDE sells you the model. You already have the model. Brud gives you the hands.",
  closing: "The AI decides. Brud executes. You approve.",

  // The four pains that matter most.
  pains: [
    {
      pain: "\u201CI ran out of credits again.\u201D",
      fix: "You use the free web chat, so there is no meter. Vibe code all night.",
    },
    {
      pain: "\u201CMy project is too big for the AI.\u201D",
      fix: "Brud gives it a map, not a dump. Proven on a real 384,000-line codebase.",
    },
    {
      pain: "\u201CThe AI deleted my files and I couldn\u2019t get them back.\u201D",
      fix: "Every session is snapshotted. Revert 1,000 files in one click. No Git required.",
    },
    {
      pain: "\u201CI want the best model, not the one my tool sells me.\u201D",
      fix: "Gemini, Claude, DeepSeek, Grok. Switch tabs, not subscriptions.",
    },
  ],

  benchmarks: {
    title: "It\u2019s fast, and we proved it",
    lede: "Tested on a real 384K LOC codebase, manually verified end to end.",
    axis: "Files processed in one block",
    max: 1000,
    rows: [
      { name: "Create Files", files: 1000, scale: "1,000 files", result: "1,000/1,000 created, unique content", time: "Under 1 second", short: "< 1 s" },
      { name: "Search & Replace", files: 467, scale: "467 files / 384K LOC", result: "467 patched, 0 failed", time: "Milliseconds", short: "ms" },
      { name: "Append Multi", files: 467, scale: "467 files", result: "467 modified, 0 failed", time: "Milliseconds", short: "ms" },
      { name: "Revert Session", files: 1000, scale: "1,000 files", result: "1,000/1,000 reverted", time: "Milliseconds", short: "ms" },
      { name: "Restore Session", files: 1000, scale: "1,000 files", result: "1,000/1,000 restored", time: "Milliseconds", short: "ms" },
    ],
    note: "100% success rate across every benchmark.",
    // Headline chips on the benchmark card. Same facts as above, just pulled up.
    highlights: [
      { label: "Success", value: "100%" },
      { label: "Failed", value: "0" },
      { label: "Codebase", value: "384K LOC" },
      { label: "Fastest", value: "< 1 s" },
    ],
  },

  stats: [
    { value: "21", label: "operation types" },
    { value: "384K", label: "lines tested" },
    { value: "7 days", label: "to recover deleted sessions" },
    { value: "12+", label: "test suites, no I/O mocking" },
  ],
};
