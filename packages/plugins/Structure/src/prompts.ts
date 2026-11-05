/**
 * Prompt fragments owned by the Structure plugin.
 *
 * `ToolRegistrationOptions` in the Phase 6.B kernel contract has no
 * `promptDescriptor`/`promptFragment` field, so the fragments are exported for
 * the Phase 10 host integration instead of being attached at registration.
 */
export const EXTRACT_STRUCTURE_PROMPT_FRAGMENT = `[CALL extract_structure]
directoryPath: string   # workspace-relative directory to map
depth: number           # optional; 0 (default) means unlimited
[END]

Returns a token-efficient JSON map of the directory. Binary files are marked
[binary]; text files report their line count. Hidden entries, node_modules,
dist, build, out, coverage, vendor, and similar generated directories are
skipped.`;

export const CODEBASE_METADATA_PROMPT_FRAGMENT = `[CALL codebase_metadata]
[END]

Returns the workspace root label, total file and folder counts, and the
directory holding the most direct files. Hidden and generated directories are
skipped.`;

export const STRUCTURE_PROMPT_FRAGMENTS = {
  extract_structure: EXTRACT_STRUCTURE_PROMPT_FRAGMENT,
  codebase_metadata: CODEBASE_METADATA_PROMPT_FRAGMENT,
} as const;