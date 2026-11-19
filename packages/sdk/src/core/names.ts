import { SdkError } from './errors.js';

const NAME = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/u;

/** Whether `name` is a valid participant, exposure or event name (`acme.notes`, `brud.settings.reader`). */
export function isValidName(name: string): boolean {
  return NAME.test(name);
}

/** The binding key of an exposure: `name@major`. */
export function exposureKey(name: string, major: number): string {
  return `${name}@${String(major)}`;
}

/**
 * Validates a name.
 *
 * @throws {SdkError} `SDK_DEFINITION_INVALID` when it is not valid.
 */
export function assertName(name: unknown, what: string): string {
  if (typeof name !== 'string' || !isValidName(name)) {
    throw new SdkError('SDK_DEFINITION_INVALID', `${what} "${String(name)}" is not a valid dotted lower-case name`);
  }

  return name;
}

/**
 * Validates a major version (a positive integer; default 1).
 *
 * @throws {SdkError} `SDK_DEFINITION_INVALID` when it is not.
 */
export function assertMajor(version: unknown, what: string): number {
  const major = version ?? 1;

  if (typeof major !== 'number' || !Number.isInteger(major) || major < 1) {
    throw new SdkError('SDK_DEFINITION_INVALID', `${what}: version must be a positive integer major`);
  }

  return major;
}
