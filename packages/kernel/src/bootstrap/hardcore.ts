import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve as resolvePath } from 'node:path';
import type { ServiceDescriptor } from '../contracts/serviceDescriptor.js';
import { BrudConfigError } from './config/types.js';

/**
 * The generic hardcore mechanism.
 *
 * This module knows how to verify and boot any compiled hardcore entry. It
 * does not hold the compiled list and knows nothing about what any listed
 * service does: it never names a service, a token, or a method. Every entry
 * carries its own contract version, its own contract interface, and its own
 * boot hook. The mechanism compares each entry against its own declaration and
 * calls each entry's hook with one uniform signature.
 */

/** Check that refused a hardcore service. */
export type HardcoreCheck = 'presence' | 'contract' | 'content-hash';

/** One composed participant, as recorded by the loader for hardcore hooks. */
export interface HardcoreBootEntry {
  /** Service token id declared by the descriptor. */
  readonly token: string;

  /** Config path used to compose the service. */
  readonly path: string;

  /**
   * Whether the composition's config declared the service first-party.
   *
   * Planned: recorded for the composition's officialness mapping; no current
   * reader consumes the boot-time record.
   */
  readonly official: boolean;

  /** Package content digest used as the provisional content binding. */
  readonly contentHash: string;
}

/**
 * What the mechanism hands one hardcore entry's boot hook.
 *
 * Every hook receives the same shape: the entry's own token and verified
 * package digest, and the composition the loader assembled.
 */
export interface HardcoreBootContext {
  /** Token id of the entry whose hook is running. */
  readonly token: string;

  /** Verified package content digest of the entry whose hook is running. */
  readonly contentHash: string;

  /** Every composed participant, in config order. */
  readonly composition: readonly HardcoreBootEntry[];
}

/**
 * Uniform boot hook signature for every hardcore entry.
 *
 * The hook narrows `instance` structurally to whatever its own entry declares.
 * The kernel calls it once, after every service has initialized and before the
 * kernel enters `RUNNING`, while the hardcore service is still mutable.
 */
export type HardcoreBootHook = (instance: unknown, context: HardcoreBootContext) => void;

/** Contract a hardcore entry declares for its own service. */
export interface HardcoreContract {
  /** Contract version the kernel was compiled to expect. */
  readonly contractVersion: string;

  /** Methods the descriptor must declare. */
  readonly contractInterface: readonly string[];

  /** Boot hook the kernel calls while the service is still mutable. */
  readonly boot: HardcoreBootHook;
}

/** One fixed hardcore entry compiled into the kernel. */
export interface HardcoreService extends HardcoreContract {
  /** Service token id. */
  readonly token: string;

  /** Expected digest of the source representation of the resolved package. */
  readonly expectedContentHash: string;

  /** Expected digest of the built representation of the resolved package. */
  readonly expectedBuiltContentHash: string;
}

/** Composed service as seen by the loader before registration. */
export interface ComposedServiceDescriptor {
  /** Descriptor returned by the service module. */
  readonly descriptor: ServiceDescriptor<unknown, unknown>;

  /** Config path used to compose the service. */
  readonly path: string;

  /** Whether the config declared the service first-party. */
  readonly official: boolean;

  /** Absolute file the config path resolved to. */
  readonly resolvedPath: string;
}

/** Raised when a compiled-in hardcore service fails verification. */
export class HardcoreServiceError extends BrudConfigError {
  /** Hardcore service token id. */
  public readonly service: string;

  /** Check that failed. */
  public readonly check: HardcoreCheck;

  /** Value the kernel was compiled to expect. */
  public readonly expected: string;

  /** Value the composed service supplied. */
  public readonly found: string;

  constructor(
    service: string,
    check: HardcoreCheck,
    expected: string,
    found: string,
    configPath: string,
  ) {
    super(
      'HARDCORE_VERIFICATION',
      `Hardcore service "${service}" failed the ${check} check: expected ${expected}; found ${found}`,
      configPath,
    );
    this.name = 'HardcoreServiceError';
    this.service = service;
    this.check = check;
    this.expected = expected;
    this.found = found;
  }
}

/** Source-relative import forms the package graph follows. */
const IMPORT_PATTERNS: readonly RegExp[] = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /^\s*import\s+['"]([^'"]+)['"]/gm,
];

/** Returns every module specifier referenced by a source file. */
function importSpecifiers(contents: string): readonly string[] {
  const found = new Set<string>();

  for (const pattern of IMPORT_PATTERNS) {
    const matcher = new RegExp(pattern.source, pattern.flags);

    for (const match of contents.matchAll(matcher)) {
      const specifier = match[1];

      if (specifier !== undefined) {
        found.add(specifier);
      }
    }
  }

  return [...found];
}

/** Resolves a relative module specifier to a real file, if one exists. */
function resolveRelativeFile(fromFile: string, specifier: string): string | undefined {
  const candidate = resolvePath(dirname(fromFile), specifier);

  if (isFile(candidate)) {
    return candidate;
  }

  if (candidate.endsWith('.js')) {
    const source = `${candidate.slice(0, -3)}.ts`;

    if (isFile(source)) {
      return source;
    }
  }

  if (extname(candidate) === '') {
    for (const suffix of ['.js', '.ts', '/index.js', '/index.ts']) {
      const next = `${candidate}${suffix}`;

      if (isFile(next)) {
        return next;
      }
    }
  }

  return undefined;
}

function isFile(candidate: string): boolean {
  if (!existsSync(candidate)) {
    return false;
  }

  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** Returns the transitive relative-import graph rooted at one file. */
function collectPackageGraph(entryPath: string): ReadonlyMap<string, string> {
  const root = dirname(resolvePath(entryPath));
  const visited = new Set<string>();
  const files = new Map<string, string>();

  const visit = (file: string): void => {
    const absolute = resolvePath(file);

    if (visited.has(absolute)) {
      return;
    }

    visited.add(absolute);
    files.set(relative(root, absolute).replaceAll('\\', '/'), absolute);

    const contents = readFileSync(absolute, 'utf8');

    for (const specifier of importSpecifiers(contents)) {
      if (!specifier.startsWith('.')) {
        continue;
      }

      const resolved = resolveRelativeFile(absolute, specifier);

      if (resolved !== undefined) {
        visit(resolved);
      }
    }
  };

  visit(entryPath);

  return files;
}

/** Returns the SHA-256 hex digest of one file. */
export function hashPackageFile(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/**
 * Computes the content digest of the resolved package.
 *
 * The digest covers the resolved entry file and every relative import it
 * reaches, canonicalized by relative path and per-file SHA-256. Bare package
 * specifiers and Node builtins are not followed: they are outside the loaded
 * package.
 *
 * @param entryPath - Absolute path the config entry resolved to.
 */
export function computePackageContentHash(entryPath: string): string {
  const graph = collectPackageGraph(entryPath);
  const manifest = [...graph.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([relativePath, absolutePath]) =>
      `${relativePath}\0${hashPackageFile(absolutePath)}`)
    .join('\n');

  return createHash('sha256')
    .update(`brud.package-content/1\0${manifest}`)
    .digest('hex');
}

/** Returns the expected digest for the representation being loaded. */
function expectedHashFor(entryPath: string, hardcore: HardcoreService): string {
  return entryPath.endsWith('.ts')
    ? hardcore.expectedContentHash
    : hardcore.expectedBuiltContentHash;
}

/**
 * Verifies every compiled hardcore entry against the composed descriptors.
 *
 * Each entry is checked against its own declaration: its own token, its own
 * contract version, its own contract interface, and its own pins. Checks run in
 * this order for each entry: presence, declared contract, package content. All
 * checks run before any service is initialized.
 *
 * @param list - The compiled hardcore list.
 * @param composed - Descriptors returned by the composed service modules.
 * @param configPath - Config path used in diagnostics.
 * @returns Package digests for the hardcore services that passed.
 */
export function verifyHardcoreServices(
  list: readonly HardcoreService[],
  composed: readonly ComposedServiceDescriptor[],
  configPath: string,
): ReadonlyMap<string, string> {
  const byToken = new Map<string, ComposedServiceDescriptor[]>();

  for (const service of composed) {
    const token = service.descriptor.token.id;
    const matches = byToken.get(token) ?? [];
    matches.push(service);
    byToken.set(token, matches);
  }

  const packageHashes = new Map<string, string>();

  for (const hardcore of list) {
    const matches = byToken.get(hardcore.token) ?? [];

    if (matches.length === 0) {
      throw new HardcoreServiceError(
        hardcore.token,
        'presence',
        `one composed service descriptor with token "${hardcore.token}"`,
        'no matching config entry',
        configPath,
      );
    }

    if (matches.length > 1) {
      throw new HardcoreServiceError(
        hardcore.token,
        'presence',
        `exactly one composed service descriptor with token "${hardcore.token}"`,
        `${String(matches.length)} matching config entries`,
        configPath,
      );
    }

    const service = matches[0] as ComposedServiceDescriptor;
    const contract = service.descriptor.contract;

    if (contract === undefined) {
      throw new HardcoreServiceError(
        hardcore.token,
        'contract',
        `contract version "${hardcore.contractVersion}" declaring [${hardcore.contractInterface.join(', ')}]`,
        'no contract declaration on the descriptor',
        configPath,
      );
    }

    if (contract.version !== hardcore.contractVersion) {
      throw new HardcoreServiceError(
        hardcore.token,
        'contract',
        `contract version "${hardcore.contractVersion}"`,
        `contract version "${contract.version}"`,
        configPath,
      );
    }

    const missing = hardcore.contractInterface.filter(
      (method) => !contract.methods.includes(method),
    );

    if (missing.length > 0) {
      throw new HardcoreServiceError(
        hardcore.token,
        'contract',
        `contract interface [${hardcore.contractInterface.join(', ')}]`,
        `contract interface [${contract.methods.join(', ')}] (missing ${missing.join(', ')})`,
        configPath,
      );
    }

    const foundHash = ((): string => {
      try {
        return computePackageContentHash(service.resolvedPath);
      } catch (error: unknown) {
        throw new HardcoreServiceError(
          hardcore.token,
          'content-hash',
          `a readable package at "${service.resolvedPath}"`,
          `unreadable package (${error instanceof Error ? error.message : String(error)})`,
          configPath,
        );
      }
    })();
    const expectedHash = expectedHashFor(service.resolvedPath, hardcore);

    if (foundHash !== expectedHash) {
      throw new HardcoreServiceError(
        hardcore.token,
        'content-hash',
        `package content hash "${expectedHash}"`,
        `package content hash "${foundHash}" for "${service.resolvedPath}"`,
        configPath,
      );
    }

    packageHashes.set(hardcore.token, foundHash);
  }

  return packageHashes;
}

/**
 * Builds the boot-call entries for every composed service.
 *
 * Hardcore services use their verified package digest. Other services use the
 * digest of their resolved entry file; that is provisional until the loader
 * supplies verified publisher and content bindings.
 *
 * @param composed - Descriptors returned by the composed service modules.
 * @param packageHashes - Verified hardcore package digests.
 */
export function buildHardcoreBootEntries(
  composed: readonly ComposedServiceDescriptor[],
  packageHashes: ReadonlyMap<string, string>,
): readonly HardcoreBootEntry[] {
  return composed.map((service) => ({
    token: service.descriptor.token.id,
    path: service.path,
    official: service.official,
    contentHash: packageHashes.get(service.descriptor.token.id)
      ?? contentHashForEntry(service.resolvedPath),
  }));
}

/** Digests a resolved file, or a bare package specifier, as a provisional binding. */
function contentHashForEntry(resolvedPath: string): string {
  try {
    return hashPackageFile(resolvedPath);
  } catch {
    return createHash('sha256')
      .update(`brud.entry-specifier/1\0${resolvedPath}`)
      .digest('hex');
  }
}

/** One initialized service, as the engine reports it to the boot loader. */
export interface HardcoreInitializedInstance {
  /** Token id of the initialized service. */
  readonly tokenId: string;

  /** The initialized instance. */
  readonly instance: unknown;
}

/**
 * Calls every compiled entry's boot hook with the uniform signature.
 *
 * Hooks run in list order. Each hook receives its own initialized instance,
 * its own token, its own verified package digest, and the composition. An
 * entry with no initialized instance is skipped; the presence check refuses
 * that composition before any service is constructed.
 *
 * @param list - The compiled hardcore list.
 * @param instances - Every initialized service, in initialization order.
 * @param packageHashes - Verified hardcore package digests from verification.
 * @param composition - Every composed participant, in config order.
 */
export function invokeHardcoreBootHooks(
  list: readonly HardcoreService[],
  instances: readonly HardcoreInitializedInstance[],
  packageHashes: ReadonlyMap<string, string>,
  composition: readonly HardcoreBootEntry[],
): void {
  for (const hardcore of list) {
    const match = instances.find((entry) => entry.tokenId === hardcore.token);

    if (match === undefined) {
      continue;
    }

    const context: HardcoreBootContext = Object.freeze({
      token: hardcore.token,
      contentHash: packageHashes.get(hardcore.token) ?? '',
      composition,
    });

    hardcore.boot(match.instance, context);
  }
}