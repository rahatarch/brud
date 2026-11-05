export type { DirectoryEntryLike, StructureFileSystem } from './fsPort.js';
export {
  BINARY_EXTENSIONS,
  extractDirectoryStructure,
} from './structure.js';
export type { StructureExtractionOptions, StructureNode } from './structure.js';
export { extractCodebaseMetadata } from './metadata.js';
export type { CodebaseMetadata } from './metadata.js';
export {
  CODEBASE_METADATA_PROMPT_FRAGMENT,
  EXTRACT_STRUCTURE_PROMPT_FRAGMENT,
  STRUCTURE_PROMPT_FRAGMENTS,
} from './prompts.js';
export {
  createStructurePlugin,
  structureManifest,
  structurePlugin,
} from './plugin.js';
export { structurePlugin as default } from './plugin.js';
export {
  baseNameRelativePath,
  extensionOf,
  joinRelativePath,
  normalizeRelativePath,
} from './pathUtils.js';