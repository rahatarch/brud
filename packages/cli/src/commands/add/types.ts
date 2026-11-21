import type { Finding } from '../../core/report.js';

/** A package tarball fetched into a scratch folder. */
export interface Fetched {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
  readonly tarball: string;
}

/** What preflight learned about a package, for the install step and the final advice. */
export interface Inspected {
  readonly findings: Finding[];
  readonly exposures: readonly string[];
  readonly caged: boolean;
  readonly native: boolean;
  readonly requiresOfficial: boolean;
  readonly powers: readonly string[];
}
