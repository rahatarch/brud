import { posix, win32 } from 'node:path';
import type { PlatformPath } from 'node:path';
import type { IStorageDriver } from '../../../../drivers/contracts/index.js';
import { PathTraversalViolationError } from './errors.js';
import type { PathViolationRule } from './errors.js';

export { PathTraversalViolationError } from './errors.js';
export type { PathViolationDetails, PathViolationRule } from './errors.js';

export type PathFlavor = 'posix' | 'win32';

export interface PathValidatorOptions {
  readonly flavor?: PathFlavor;
}

export interface PathResolutionSuccess {
  readonly ok: true;
  readonly path: string;
}

export interface PathResolutionFailure {
  readonly ok: false;
  readonly error: PathTraversalViolationError;
}

export type PathResolution = PathResolutionSuccess | PathResolutionFailure;

const NULL_BYTE_PATTERN = /\0/;
const UNC_PATTERN = /^[\\/]{2}/;
const DRIVE_QUALIFIER_PATTERN = /^[A-Za-z]:/;
const SEGMENT_SEPARATOR_PATTERN = /[\\/]/;
const WINDOWS_TRAILING_DOTS_OR_SPACES_PATTERN = /[. ]+$/u;
const WINDOWS_RESERVED_DEVICE_PATTERN = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/iu;

export function defaultPathFlavor(): PathFlavor {
  return process.platform === 'win32' ? 'win32' : 'posix';
}

function pathApiFor(flavor: PathFlavor): PlatformPath {
  return flavor === 'win32' ? win32 : posix;
}

function violation(
  rule: PathViolationRule,
  root: string,
  candidatePath: string,
  reason: string,
): PathTraversalViolationError {
  return new PathTraversalViolationError({ rule, root, candidatePath, reason });
}

function assertWindowsSegments(candidate: string, segments: readonly string[], root: string): void {
  for (const segment of segments) {
    if (segment.length === 0 || segment === '.') {
      continue;
    }

    const normalized = segment.replace(WINDOWS_TRAILING_DOTS_OR_SPACES_PATTERN, '');

    if (normalized === '' || normalized === '.' || normalized === '..') {
      throw violation(
        'TRAVERSAL',
        root,
        candidate,
        'Windows path segments must not resolve to "." or ".." after trailing dots and spaces are trimmed',
      );
    }

    if (normalized !== segment) {
      throw violation(
        'TRAVERSAL',
        root,
        candidate,
        'Windows path segments with trailing dots or spaces are not permitted',
      );
    }

    if (WINDOWS_RESERVED_DEVICE_PATTERN.test(normalized)) {
      throw violation(
        'RESERVED_DEVICE',
        root,
        candidate,
        'Windows reserved device names are not permitted',
      );
    }

    if (normalized.includes(':')) {
      throw violation(
        'ALTERNATE_DATA_STREAM',
        root,
        candidate,
        'Windows alternate data streams are not permitted',
      );
    }
  }
}

export function assertSafeRelativePath(
  candidate: string,
  flavor: PathFlavor = defaultPathFlavor(),
  root = '',
): string {
  if (NULL_BYTE_PATTERN.test(candidate)) {
    throw violation('NULL_BYTE', root, candidate, 'path contains a null byte');
  }

  if (candidate === '' || candidate === '.') {
    return candidate;
  }

  if (UNC_PATTERN.test(candidate)) {
    throw violation('TRAVERSAL', root, candidate, 'UNC paths are not permitted');
  }

  if (DRIVE_QUALIFIER_PATTERN.test(candidate)) {
    throw violation('TRAVERSAL', root, candidate, 'drive-qualified paths are not permitted');
  }

  const api = pathApiFor(flavor);
  if (api.isAbsolute(candidate)) {
    throw violation('TRAVERSAL', root, candidate, 'absolute paths are not permitted');
  }

  const segments = candidate.split(SEGMENT_SEPARATOR_PATTERN);

  if (flavor === 'win32') {
    assertWindowsSegments(candidate, segments, root);
    return candidate;
  }

  if (segments.some((segment) => segment === '..')) {
    throw violation(
      'TRAVERSAL',
      root,
      candidate,
      'parent traversal segments are not permitted',
    );
  }

  return candidate;
}

export class PathValidator {
  private readonly api: PlatformPath;

  private readonly rootPath: string;

  private readonly pathFlavor: PathFlavor;

  constructor(root: string, options?: PathValidatorOptions) {
    this.pathFlavor = options?.flavor ?? defaultPathFlavor();
    this.api = pathApiFor(this.pathFlavor);

    if (root.length === 0 || NULL_BYTE_PATTERN.test(root)) {
      throw new Error('Root path must be a non-empty absolute path without null bytes');
    }

    if (!this.api.isAbsolute(root)) {
      throw new Error(`Root path must be absolute for the "${this.pathFlavor}" flavor: "${root}"`);
    }

    this.rootPath = this.api.resolve(root);
  }

  get root(): string {
    return this.rootPath;
  }

  get flavor(): PathFlavor {
    return this.pathFlavor;
  }

  resolve(relativePath: string): string {
    const candidate = assertSafeRelativePath(relativePath, this.pathFlavor, this.rootPath);

    if (candidate === '' || candidate === '.') {
      return this.rootPath;
    }

    const absolutePath = this.api.resolve(this.rootPath, candidate);
    this.assertWithinBoundary(absolutePath, relativePath);
    return absolutePath;
  }

  assertValid(relativePath: string): string {
    return this.resolve(relativePath);
  }

  validate(relativePath: string): string {
    return this.resolve(relativePath);
  }

  tryResolve(relativePath: string): PathResolution {
    try {
      return { ok: true, path: this.resolve(relativePath) };
    } catch (error: unknown) {
      if (error instanceof PathTraversalViolationError) {
        return { ok: false, error };
      }
      throw error;
    }
  }

  isContained(relativePath: string): boolean {
    return this.tryResolve(relativePath).ok;
  }

  async resolveContained(relativePath: string, driver: IStorageDriver): Promise<string> {
    const lexicalPath = this.assertValid(relativePath);
    const realRoot = await driver.realpath(this.rootPath);
    const realCandidate = await this.resolveNearestExistingRealPath(driver, lexicalPath, relativePath);

    if (!this.isWithinRealBoundary(realRoot, realCandidate)) {
      throw violation(
        'SYMLINK_ESCAPE',
        this.rootPath,
        relativePath,
        'resolved real path escapes the workspace boundary through a symbolic link',
      );
    }

    return realCandidate;
  }

  private async resolveNearestExistingRealPath(
    driver: IStorageDriver,
    target: string,
    candidatePath: string,
  ): Promise<string> {
    const missingSegments: string[] = [];
    let current = target;

    for (;;) {
      if (await driver.exists(current)) {
        const realCurrent = await driver.realpath(current);
        if (missingSegments.length === 0) {
          return realCurrent;
        }
        return this.api.resolve(realCurrent, ...missingSegments.slice().reverse());
      }

      const entry = await driver.lstat(current);
      if (entry?.isSymbolicLink === true) {
        throw violation(
          'SYMLINK_ESCAPE',
          this.rootPath,
          candidatePath,
          'symbolic link target does not exist or cannot be resolved',
        );
      }

      const parent = this.api.dirname(current);
      if (parent === current) {
        return target;
      }

      missingSegments.push(this.api.basename(current));
      current = parent;
    }
  }

  private isWithinRealBoundary(realRoot: string, realCandidate: string): boolean {
    const relativePath = this.api.relative(realRoot, realCandidate);

    return relativePath === ''
      || (
        relativePath !== '..'
        && !relativePath.startsWith(`..${this.api.sep}`)
        && !this.api.isAbsolute(relativePath)
      );
  }

  private assertWithinBoundary(absolutePath: string, originalPath: string): void {
    const relativePath = this.api.relative(this.rootPath, absolutePath);

    if (relativePath === '') {
      return;
    }

    const escapesBoundary =
      relativePath === '..'
      || relativePath.startsWith(`..${this.api.sep}`)
      || this.api.isAbsolute(relativePath);

    if (escapesBoundary) {
      throw violation(
        'OUTSIDE_ROOT',
        this.rootPath,
        originalPath,
        'resolved path escapes the workspace boundary',
      );
    }
  }
}
