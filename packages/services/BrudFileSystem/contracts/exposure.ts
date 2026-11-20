/** Exposure name for the file system (`brud.filesystem@1`). */
export const FILESYSTEM_EXPOSURE = 'brud.filesystem';

/** Capability that grants the read-only `brud.fileSystem` handle. */
export const FS_READ_CAPABILITY = 'fs:read';

/** Capability that grants the full (write) `brud.fileSystem` handle. */
export const FS_WRITE_CAPABILITY = 'fs:write';

/** Exposure name for the file mutation journal (`brud.filesystem.journal@1`); official callers only. */
export const FILESYSTEM_JOURNAL_EXPOSURE = 'brud.filesystem.journal';
