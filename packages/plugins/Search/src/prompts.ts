/**
 * Prompt fragment owned by the Search plugin.
 *
 * The Phase 6.B `ToolRegistrationOptions` contract has no prompt-fragment
 * field, so this is exported for the Phase 10 host integration.
 */
export const SEARCH_FILES_PROMPT_FRAGMENT = `[CALL search_files]
patterns: string[]     # glob patterns or simple words; at least one
excludePatterns: string[]  # optional patterns to skip
directory: string      # optional workspace-relative directory
extensions: string[]   # optional extension filter such as [".ts"]
recursive: boolean     # optional; defaults to true
maxResults: number     # optional cap; omit for all results
[END]

Searches the workspace for files by name, glob, or extension. Generated
directories (node_modules, dist, build, .git, and similar) and hidden
directories are skipped. Results are workspace-relative paths.`;

export const SEARCH_PROMPT_FRAGMENTS = {
  search_files: SEARCH_FILES_PROMPT_FRAGMENT,
} as const;