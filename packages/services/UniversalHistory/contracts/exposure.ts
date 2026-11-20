/** Exposure name for unified history (`brud.history@1`). */
export const UNIVERSAL_HISTORY_EXPOSURE = 'brud.history';

/** Exposure name for per-participant namespace history (`brud.history.namespace@1`). */
export const NAMESPACE_HISTORY_EXPOSURE = 'brud.history.namespace';

/** Floor capability required by both history policies. */
export const HISTORY_READ_CAPABILITY = 'history:read';

/** Capability that widens the projection to the writable surface. */
export const HISTORY_WRITE_CAPABILITY = 'history:write';

/** Exposures UniversalHistory resolves (literal names, BC-10). */
export const HISTORY_FILESYSTEM_EXPOSURE = 'brud.filesystem';
export const HISTORY_SETTINGS_READER_EXPOSURE = 'brud.settings.reader';

/** Exposure name for the history journal (`brud.history.journal@1`). */
export const HISTORY_JOURNAL_EXPOSURE = 'brud.history.journal';
