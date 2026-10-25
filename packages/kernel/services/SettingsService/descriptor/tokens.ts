import { createServiceToken } from '../../../src/contracts/serviceToken.js';
import type {
  ISettingsReader,
  ISettingsService,
} from '../contracts/ISettingsService.js';

/** Kernel service token for `brud.core.settings`. */
export const SettingsToken = createServiceToken<ISettingsService>(
  'brud.core.settings',
  'Immutable kernel settings and policy snapshot service',
);

/**
 * Read-only service token for `brud.core.settings.reader`.
 *
 * Every caller may resolve this token. It exposes the frozen snapshot and
 * change subscription only, so plugins and userland code never reach a mutator.
 */
export const SettingsReaderToken = createServiceToken<ISettingsReader>(
  'brud.core.settings.reader',
  'Read-only settings snapshot service available to every caller',
);
