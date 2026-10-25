import type {
  IWorkspacePathPort,
  WorkspacePathEntry,
} from '../contracts/IWorkspaceService.js';

/** One fabricated filesystem entry. */
export interface MapPathEntry {
  /** Absolute target when the entry is a symbolic link. */
  readonly target?: string;
}

const SEPARATOR_PATTERN = /[\\/]+/g;

/**
 * Normalizes a path into the comparison form used by {@link MapPathPort} keys.
 *
 * The fake is separator-agnostic so one map can describe POSIX and Windows
 * layouts; keys are always `'/'`-separated and free of duplicate or trailing
 * separators.
 *
 * @param absolutePath - Path to normalize.
 */
export function mapPathKey(absolutePath: string): string {
  const collapsed = absolutePath.replace(SEPARATOR_PATTERN, '/');

  if (collapsed.length > 1 && collapsed.endsWith('/')) {
    return collapsed.slice(0, -1);
  }

  return collapsed;
}

/**
 * In-memory filesystem port for workspace tests.
 *
 * Supports real directories, regular files, and symbolic links (including
 * chained and dangling links) without touching the host filesystem, which is
 * what makes Windows-flavored symlink tests possible on POSIX.
 */
export class MapPathPort implements IWorkspacePathPort {
  private readonly entries = new Map<string, MapPathEntry>();

  /**
   * @param entries - Initial entries keyed by normalized absolute path.
   */
  constructor(entries?: Record<string, MapPathEntry>) {
    for (const [path, entry] of Object.entries(entries ?? {})) {
      this.entries.set(mapPathKey(path), entry);
    }
  }

  /**
   * Registers a directory or regular file.
   *
   * @param absolutePath - Path to register.
   */
  addEntry(absolutePath: string): this {
    this.entries.set(mapPathKey(absolutePath), {});

    return this;
  }

  /**
   * Registers a symbolic link.
   *
   * @param absolutePath - Link path.
   * @param target - Absolute link target, which may not exist.
   */
  addSymlink(absolutePath: string, target: string): this {
    this.entries.set(mapPathKey(absolutePath), { target });

    return this;
  }

  async lstat(absolutePath: string): Promise<WorkspacePathEntry | null> {
    const entry = this.entries.get(mapPathKey(absolutePath));

    if (entry === undefined) {
      return null;
    }

    return { isSymbolicLink: entry.target !== undefined };
  }

  async realpath(absolutePath: string): Promise<string> {
    let current = mapPathKey(absolutePath);

    for (let hops = 0; hops < 32; hops += 1) {
      const entry = this.entries.get(current);

      if (entry === undefined) {
        throw Object.assign(new Error(`ENOENT: no such file or directory, '${current}'`), {
          code: 'ENOENT',
        });
      }

      if (entry.target === undefined) {
        return current;
      }

      current = mapPathKey(entry.target);
    }

    throw Object.assign(new Error('ELOOP: too many symbolic links'), { code: 'ELOOP' });
  }
}

/**
 * Port whose every path exists and canonicalizes to itself.
 *
 * Useful for purely lexical tests: Windows drive/device/reserved-name rules
 * and multi-root routing do not need a real directory tree.
 */
export function createIdentityPathPort(): IWorkspacePathPort {
  return {
    lstat: async (): Promise<WorkspacePathEntry> => ({ isSymbolicLink: false }),
    realpath: async (absolutePath: string): Promise<string> => absolutePath,
  };
}
