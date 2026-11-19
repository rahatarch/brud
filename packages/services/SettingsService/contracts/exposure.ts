import type { ConfigScope, SettingsSnapshot } from './ISettingsService.js';

/** Capability-gated settings exposure (`brud.settings@1`); mutators need {@link SETTINGS_WRITE_CAPABILITY}. */
export const SETTINGS_EXPOSURE = 'brud.settings';

/** Read-only settings exposure (`brud.settings.reader@1`), open to every caller. */
export const SETTINGS_READER_EXPOSURE = 'brud.settings.reader';

/** Capability that grants `getSnapshot`/`onChange` on `brud.settings`. */
export const SETTINGS_READ_CAPABILITY = 'settings:read';

/** Capability that adds `update` and `reload` to the `brud.settings` handle. */
export const SETTINGS_WRITE_CAPABILITY = 'settings:write';

/** API served under {@link SETTINGS_READER_EXPOSURE} (and the shared part of {@link SETTINGS_EXPOSURE}). */
export interface ISettingsReaderApi {
  getSnapshot(): SettingsSnapshot;
  onChange(listener: (snapshot: SettingsSnapshot) => void): () => void;
}

/** API served under {@link SETTINGS_EXPOSURE}; mutators present only with {@link SETTINGS_WRITE_CAPABILITY}. */
export interface ISettingsApi extends ISettingsReaderApi {
  reload?(): Promise<SettingsSnapshot>;
  update?(scope: ConfigScope, patch: Partial<SettingsSnapshot>): Promise<SettingsSnapshot>;
}
