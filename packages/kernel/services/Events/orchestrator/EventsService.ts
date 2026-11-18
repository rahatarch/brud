import type {
  EventDeclaration,
  KernelCallAuthority,
} from '../../../src/contracts/index.js';
import {
  EventDuplicateDeclarationError,
  EventNameCollisionError,
} from '../contracts/errors.js';
import type { IEventsService } from '../contracts/IEventsService.js';

/** One declared event held in the events hardcore's catalogue. */
interface CatalogueEntry {
  readonly name: string;
  readonly major: number;
  readonly scope: string;
  readonly policy?: Readonly<Record<string, unknown>>;
  readonly owner: string;
}

/** Extracts the integer major version from a numeric or semver version. */
function eventMajorVersion(version: number | string | undefined): number {
  if (version === undefined) {
    return 1;
  }

  if (typeof version === 'number') {
    return version;
  }

  return Number.parseInt(version.split('.')[0] ?? '', 10);
}

/** Formats the deterministic `name@major` key for a catalogue entry. */
function catalogueKey(name: string, major: number): string {
  return `${name}@${String(major)}`;
}

export class EventsService implements IEventsService {
  private authority: KernelCallAuthority | undefined;

  readonly #catalogue = new Map<string, CatalogueEntry>();

  readonly #owners = new Map<string, string>();

  public bindAuthority(value: KernelCallAuthority): void {
    this.authority = value;
  }

  /**
   * Registers one declared event in the boot-time catalogue under `owner`.
   *
   * Refuses name collisions across different owners and duplicate
   * `(name, major)` declarations by the same owner.
   */
  public registerDeclaration(owner: string, declaration: EventDeclaration): void {
    const { name } = declaration;
    const major = eventMajorVersion(declaration.version);
    const scope = declaration.scope ?? 'kernel';

    const nameOwner = this.#owners.get(name);

    if (nameOwner !== undefined && nameOwner !== owner) {
      throw new EventNameCollisionError(name, nameOwner);
    }

    const key = catalogueKey(name, major);

    if (this.#catalogue.has(key)) {
      throw new EventDuplicateDeclarationError(name, major);
    }

    this.#owners.set(name, owner);
    this.#catalogue.set(
      key,
      Object.freeze({
        name,
        major,
        scope,
        ...(declaration.policy === undefined ? {} : { policy: declaration.policy }),
        owner,
      }),
    );
  }

  public emit(name: string, payload: unknown): void {
    void name;
    void payload;
  }

  public pull(subscriptionId: string): readonly unknown[] {
    void subscriptionId;
    return [];
  }

  public close(subscriptionId: string): void {
    void subscriptionId;
  }

  public list(): readonly string[] {
    return Array.from(this.#catalogue.keys());
  }
}