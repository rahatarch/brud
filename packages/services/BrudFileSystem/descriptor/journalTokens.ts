import { createServiceToken } from '@brud/kernel';
import type { IFileMutationJournalApi } from '../events/types.js';

/**
 * Service token for the filesystem-owned mutation journal API.
 *
 * The journal is the filesystem service's concept. This token is the
 * filesystem service's exposed API for it: the owner registers it, the giver's
 * access policy decides who may resolve it, and the kernel treats it as an
 * ordinary service. The kernel does not import it or know what it carries.
 */
export const FileMutationJournalToken = createServiceToken<IFileMutationJournalApi>(
  'brud.core.filesystem.mutationJournal',
  'Filesystem-owned mutation journal and storage driver exposed to permitted callers',
);