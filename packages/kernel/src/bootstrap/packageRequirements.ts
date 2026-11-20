import { readFileSync } from 'node:fs';

/**
 * The powers a participant package may say it needs. A fixed vocabulary, so the
 * refusal message is never free text from the package.
 */
export const PACKAGE_POWERS = ['environment', 'filesystem', 'network', 'process'] as const;

/** What a participant package requires of the composition that loads it. */
export interface PackageRequirements {
  /** The package refuses to load unless the composition declares its entry official. */
  readonly official: boolean;
  /** The powers it will use, shown to the owner next to the refusal. */
  readonly powers: readonly string[];
}

/** A `requires` section that is malformed. */
export class PackageRequirementsError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'PackageRequirementsError';
  }
}

const NONE: PackageRequirements = Object.freeze({ official: false, powers: Object.freeze([]) });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Reads the optional `requires` section of a participant package's data file.
 * A requirement can only refuse a load; it never grants officialness, which
 * stays the composition owner's decision.
 *
 * @param manifestPath - Absolute path of `brud.participant.json`.
 * @returns The requirements; none when the section is absent.
 * @throws {PackageRequirementsError} When the file is unreadable or the section is malformed.
 */
export function readPackageRequirements(manifestPath: string): PackageRequirements {
  let pkg: unknown;

  try {
    pkg = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
  } catch (error: unknown) {
    throw new PackageRequirementsError(`unreadable (${error instanceof Error ? error.message : String(error)})`);
  }

  const requires = isRecord(pkg) ? pkg.requires : undefined;

  if (requires === undefined) {
    return NONE;
  }

  if (!isRecord(requires)) {
    throw new PackageRequirementsError('requires must be an object');
  }

  const unknownKeys = Object.keys(requires).filter((key) => key !== 'official' && key !== 'powers');

  if (unknownKeys.length > 0) {
    throw new PackageRequirementsError(`unknown requires key(s) ${unknownKeys.join(', ')}`);
  }

  if (requires.official !== true) {
    throw new PackageRequirementsError('requires.official must be true when requires is present');
  }

  const powers = requires.powers ?? [];

  if (!Array.isArray(powers) || powers.some((power) => !(PACKAGE_POWERS as readonly unknown[]).includes(power))) {
    throw new PackageRequirementsError(`requires.powers must list only: ${PACKAGE_POWERS.join(', ')}`);
  }

  return Object.freeze({ official: true, powers: Object.freeze([...new Set(powers as string[])].sort()) });
}
