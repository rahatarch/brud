import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import type { ServiceDescriptor } from '../contracts/serviceDescriptor.js';
import { BrudConfigError } from './config/types.js';

/**
 * The kernel's fixed hardcore service set.
 *
 * This list is compiled into the kernel. It is not read from config and cannot
 * be edited at runtime. Each entry knows only the service token, the expected
 * package content digest, the contract version, the required contract
 * interface, and the boot-time call. It knows nothing about what the service
 * does.
 */

/** Check that refused a hardcore service. */
export type HardcoreCheck = 'presence' | 'contract' | 'content-hash';

/** One composed service that passed the hardcore gate. */
export interface HardcoreBootEntry {
  /** Service token id declared by the descriptor. */
  readonly token: string;

  /** Config path used to compose the service. */
  readonly path: string;

  /** Whether the config declared the service first-party. */
  readonly official: boolean;

  /** Package content digest used as the provisional content binding. */
  readonly contentHash: string;
}

/** Contract a hardcore service must declare on its descriptor. */
export interface HardcoreContract {
  /** Contract version the kernel was compiled to expect. */
  readonly contractVersion: string;

  /** Methods the descriptor must declare. */
  readonly contractInterface: readonly string[];

  /** Boot-time call the kernel makes while the service is still mutable. */
  readonly boot: (instance: unknown, entries: readonly HardcoreBootEntry[]) => void;
}

/** One fixed hardcore service compiled into the kernel. */
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
  const candidate = resolve(dirname(fromFile), specifier);

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
  const root = dirname(resolve(entryPath));
  const visited = new Set<string>();
  const files = new Map<string, string>();

  const visit = (file: string): void => {
    const absolute = resolve(file);

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
 * Verifies every hardcore service against the composed service descriptors.
 *
 * Checks run in this order: presence, declared contract, package content.
 * All checks run before any service is initialized.
 *
 * @param composed - Descriptors returned by the composed service modules.
 * @param configPath - Config path used in diagnostics.
 * @returns Package digests for the hardcore services that passed.
 */
export function verifyHardcoreServices(
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

  for (const hardcore of HARDCORE_SERVICES) {
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

/** Digests a resolved file, or a bare package specifier, for provisional issuance. */
function contentHashForEntry(resolvedPath: string): string {
  try {
    return hashPackageFile(resolvedPath);
  } catch {
    return createHash('sha256')
      .update(`brud.entry-specifier/1\0${resolvedPath}`)
      .digest('hex');
  }
}

/** Structural surface the boot call needs from the identity registry. */
interface BootIdentityRegistry {
  issue(binding: {
    readonly publisher: string;
    readonly contentHash: string;
    readonly metadata: Readonly<Record<string, unknown>>;
  }): unknown;
}

/**
 * Expected digests of the identity registry package.
 *
 * Two representations ship from one source tree: the TypeScript sources the
 * kernel tests load, and the compiled JavaScript the built package loads.
 * Both digests are pinned here. Updating either package requires a kernel
 * rebuild with new pinned digests.
 */
const IDENTITY_REGISTRY_SOURCE_HASH =
  '287905447577363625b8b46c2b3443ee199196b2001a9ce77036a938fbb98c27';
const IDENTITY_REGISTRY_BUILT_HASH =
  'f25f215d3dc02cf608ed636a66f294e9affe72eb33a73768c9e881f4731e5724';

/** The fixed hardcore list compiled into the kernel. */
export const HARDCORE_SERVICES: readonly HardcoreService[] = [
  {
    token: 'brud.core.identityRegistry',
    expectedContentHash: IDENTITY_REGISTRY_SOURCE_HASH,
    expectedBuiltContentHash: IDENTITY_REGISTRY_BUILT_HASH,
    contractVersion: '1.0.0',
    contractInterface: ['issue', 'resolve', 'retire', 'revoke'],
    boot: (instance, entries): void => {
      const registry = instance as BootIdentityRegistry;

      for (const entry of entries) {
        registry.issue({
          publisher: entry.token,
          contentHash: entry.contentHash,
          metadata: Object.freeze({
            source: 'kernel.composition',
            path: entry.path,
            official: entry.official,
            provisional: true,
          }),
        });
      }
    },
  },
];

/** Type guard used by the loader's initialized-instance list. */
export function isHardcoreToken(token: string): boolean {
  return HARDCORE_SERVICES.some((hardcore) => hardcore.token === token);
}