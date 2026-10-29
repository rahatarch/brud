import { createRequire } from 'module';

/**
 * Synchronous handle on the kernel settings defaults.
 *
 * `@brud/kernel` is ESM-only while this package compiles to CommonJS, so the
 * canonical values are read through `require`, exactly as the validation facade
 * does. Only the ratified settings constants are consumed.
 */
const kernelSettings = createRequire(__filename)('@brud/kernel') as {
  readonly KERNEL_MAX_BATCH_FILES: number;
  readonly KERNEL_HARD_MAX_AGGREGATE_BYTES: number;
  readonly READ_CONCURRENCY_MAX: number;
  readonly DEFAULT_READ_CONCURRENCY: number;
  readonly DEFAULT_READ_MAX_AGGREGATE_BYTES: number;
};

/**
 * Read governor ceilings.
 *
 * These are the canonical kernel settings values
 * (`SettingsService/model/defaults.ts`, surfaced by the validation gate as
 * `KERNEL_MAX_BATCH_FILES` / `KERNEL_HARD_MAX_AGGREGATE_BYTES` respelled here as
 * the core-facing names), not raw literals re-declared in this package. A
 * reader ceiling that disagreed with the settings clamp would be a split brain:
 * settings would accept a value the reader rejects, or vice versa. Bounding the
 * canonical bindings leaves nothing that can drift (R-6).
 */
export const MAX_BATCH_FILES: number = kernelSettings.KERNEL_MAX_BATCH_FILES;
export const MAX_AGGREGATE_BYTES: number = kernelSettings.DEFAULT_READ_MAX_AGGREGATE_BYTES;
export const HARD_MAX_AGGREGATE_BYTES: number = kernelSettings.KERNEL_HARD_MAX_AGGREGATE_BYTES;
export const MAX_READ_CONCURRENCY: number = kernelSettings.READ_CONCURRENCY_MAX;
export const DEFAULT_READ_CONCURRENCY: number = kernelSettings.DEFAULT_READ_CONCURRENCY;
export const BINARY_SAMPLE_BYTES = 8192;
