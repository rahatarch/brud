/** Kernel-relative path helpers.
 *
 * The kernel filesystem speaks workspace-relative POSIX-style paths. These
 * helpers keep that contract deterministic on every host platform.
 */

export function normalizeRelativePath(input: string): string {
  let value = input.replace(/\\/g, '/');

  while (value.startsWith('./')) {
    value = value.slice(2);
  }

  value = value.replace(/\/+$/u, '');

  return value === '.' ? '' : value;
}

export function joinRelativePath(...segments: readonly string[]): string {
  const joined = segments
    .map((segment) => segment.replace(/^\/+|\/+$/gu, ''))
    .filter((segment) => segment.length > 0)
    .join('/');

  return normalizeRelativePath(joined);
}

export function baseNameRelativePath(input: string): string {
  const normalized = normalizeRelativePath(input);
  if (normalized === '') {
    return '';
  }

  const index = normalized.lastIndexOf('/');
  return index === -1 ? normalized : normalized.slice(index + 1);
}

/** Lower-case extension including the dot, or an empty string. */
export function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  return index <= 0 ? '' : fileName.slice(index).toLowerCase();
}