export {
  createReaderPlugin,
  readerManifest,
  readerPlugin,
  readerManifest as manifest,
  readerPlugin as plugin,
} from './plugin.js';
export { readerPlugin as default } from './plugin.js';

export {
  buildBinaryEntry,
  buildReadResult,
  buildSkipEntry,
  buildTextEntry,
  clampEntriesToBudget,
  computeLineRange,
  countTotalLines,
  LineRangeError,
  sliceLineRange,
  summarizeReadResult,
} from './envelope.js';
export type {
  LineRange,
  ReadEntryOptions,
  ReadFileEntry,
  ReadLimitHit,
  ReadResult,
  ReadSkipEntry,
  ReadSkipReason,
} from './envelope.js';

export {
  BINARY_SNIFF_BYTES,
  ByteBudget,
  DEFAULT_MAX_BYTES,
  GovernorError,
  MAX_CONCURRENCY,
  MAX_FILES_PER_BATCH,
  assertBatchLimit,
  globToRegExp,
  isExcludedPath,
  isGlobPattern,
  splitCommaList,
} from './governor.js';
export type {
  ChunkOutcome,
  GovernorErrorCode,
} from './governor.js';

export {
  ReadInputError,
  SearchExecutionError,
  isAbsolutePath,
  isBinaryBytes,
  readDirectory,
  readFile,
  readFiles,
  toAbsolutePath,
  toWorkspacePath,
} from './readEngine.js';
export type {
  ReaderDirectoryEntry,
  ReaderFileSystem,
  ReaderResolveImportsOptions,
  ReaderRuntime,
  ReaderStat,
  ReaderUtilities,
  ToolDispatchResult,
} from './readEngine.js';

export {
  READ_DIRECTORY_SCHEMA,
  READ_FILES_SCHEMA,
  READ_FILE_SCHEMA,
} from './schemas.js';
export type {
  ReadDirectoryInput,
  ReadFileInput,
  ReadFilesInput,
} from './schemas.js';