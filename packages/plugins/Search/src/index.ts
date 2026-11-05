export type { DirectoryEntryLike, FileStatsLike, SearchFileSystem } from './fsPort.js';
export type {
  FileSearchQuery,
  FileSearchResponse,
  FileSearchResult,
} from './types.js';
export { FileSearchQueryError } from './types.js';
export { globToRegExp, isGlobPattern, matchGlob } from './globMatcher.js';
export { searchFiles } from './fileSearch.js';
export { SEARCH_FILES_PROMPT_FRAGMENT, SEARCH_PROMPT_FRAGMENTS } from './prompts.js';
export {
  createSearchPlugin,
  searchManifest,
  searchPlugin,
} from './plugin.js';
export { searchPlugin as default } from './plugin.js';