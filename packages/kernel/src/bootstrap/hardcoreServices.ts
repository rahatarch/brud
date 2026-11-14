import type { KernelCallAuthority } from '../contracts/callChain.js';
import type { ExposureDeclaration } from '../contracts/manifest.js';
import type { HardcoreBootContext, HardcoreService } from './hardcore.js';

/**
 * The kernel's fixed hardcore service set.
 *
 * This list is compiled into the kernel. It is not read from config and cannot
 * be edited at runtime. Each entry declares its own token, its own pinned
 * package digests, its own contract version, its own contract interface, and
 * its own boot hook. The generic mechanism in `hardcore.ts` verifies and boots
 * every entry the same way and knows nothing about what any entry's service
 * does.
 *
 * The kernel core never imports a hardcore service. Each boot hook narrows its
 * instance structurally to the one surface it calls.
 *
 * Two representations of each package ship from one source tree: the
 * TypeScript sources the kernel tests load, and the compiled JavaScript the
 * built package loads. Both digests are pinned per entry. Changing any file in
 * an entry's package graph requires a kernel rebuild with new pinned digests.
 */

/** Pinned digests of the identity registry package. */
const IDENTITY_REGISTRY_SOURCE_HASH =
  'b0368e85f16e05b5470c0bcce129364a9bd4af02f58e654df3cfa78da48a1b70';
const IDENTITY_REGISTRY_BUILT_HASH =
  'dc3e3bb5b69dbe221d997ba6a0858ef43c12a97a9c1684203c3dd155b1021e1b';

/** Pinned digests of the exposed API registry package. */
const EXPOSED_API_REGISTRY_SOURCE_HASH =
  '4d18d1444b7b245f2c63a59d212177fe4c18046dd7e9e609ad7c023ffa5bf4ac';
const EXPOSED_API_REGISTRY_BUILT_HASH =
  '47a9c141c6586d081a08093b31f54d99676fdac6d8663759d2cd8bd16c97f2d2';

/** Binding the identity registry records for one composed participant. */
interface IdentityBootBinding {
  readonly publisher: string;
  readonly contentHash: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/** Structural surface the identity registry's boot hook calls. */
interface IdentityBootSurface {
  issue(binding: IdentityBootBinding): { readonly token: string };
}

/** Structural surface the exposed API registry's boot hook calls. */
interface ExposedApiBootSurface {
  attachKernel(
    authority: KernelCallAuthority,
    ownerPins: Readonly<Record<string, string>>,
  ): void;
  register(owner: string, declaration: ExposureDeclaration): void;
  seal(): void;
}

/** Narrows an instance to the identity registry's boot surface. */
function asIdentityBootSurface(instance: unknown, token: string): IdentityBootSurface {
  if (
    instance === null
    || typeof instance !== 'object'
    || typeof (instance as { readonly issue?: unknown }).issue !== 'function'
  ) {
    throw new TypeError(`Hardcore service "${token}" does not expose its declared boot surface`);
  }

  return instance as IdentityBootSurface;
}

/** Narrows an instance to the exposed API registry's boot surface. */
function asExposedApiBootSurface(instance: unknown, token: string): ExposedApiBootSurface {
  if (
    instance === null
    || typeof instance !== 'object'
    || typeof (instance as { readonly attachKernel?: unknown }).attachKernel !== 'function'
    || typeof (instance as { readonly register?: unknown }).register !== 'function'
    || typeof (instance as { readonly seal?: unknown }).seal !== 'function'
  ) {
    throw new TypeError(`Hardcore service "${token}" does not expose its declared boot surface`);
  }

  return instance as ExposedApiBootSurface;
}

/** The fixed hardcore list compiled into the kernel. */
export const HARDCORE_SERVICES: readonly HardcoreService[] = [
  {
    token: 'brud.core.identityRegistry',
    expectedContentHash: IDENTITY_REGISTRY_SOURCE_HASH,
    expectedBuiltContentHash: IDENTITY_REGISTRY_BUILT_HASH,
    contractVersion: '1.0.0',
    contractInterface: ['issue', 'resolve', 'retire', 'revoke'],
    // Records one provisional binding per composed participant while the
    // registry is still mutable, and records the issued token as that
    // participant's kernel identity.
    boot: (instance: unknown, context: HardcoreBootContext): void => {
      const registry = asIdentityBootSurface(instance, context.token);

      for (const entry of context.composition) {
        const record = registry.issue({
          publisher: entry.token,
          contentHash: entry.contentHash,
          metadata: Object.freeze({
            source: 'kernel.composition',
            path: entry.path,
            official: entry.official,
            provisional: true,
          }),
        });

        context.recordIdentity(entry.token, record.token);
      }
    },
  },
  {
    token: 'brud.core.exposedApiRegistry',
    expectedContentHash: EXPOSED_API_REGISTRY_SOURCE_HASH,
    expectedBuiltContentHash: EXPOSED_API_REGISTRY_BUILT_HASH,
    contractVersion: '1.0.0',
    contractInterface: ['register', 'resolve'],
    // Admission. Attaches the kernel's call authority and the composition's
    // name pins, registers every exposure each participant's manifest declares
    // under that participant's kernel identity, and seals the window before
    // any composed participant is constructed.
    boot: (instance: unknown, context: HardcoreBootContext): void => {
      const registry = asExposedApiBootSurface(instance, context.token);

      registry.attachKernel(context.authority, context.config.exposureOwners ?? {});

      for (const entry of context.composition) {
        if (entry.manifest.exposures.length === 0) {
          continue;
        }

        const owner = context.identityOf(entry.token);

        if (owner === undefined) {
          throw new TypeError(
            `Participant "${entry.token}" declares exposures but has no kernel identity`,
          );
        }

        for (const declaration of entry.manifest.exposures) {
          registry.register(owner, declaration);
        }
      }

      registry.seal();
    },
  },
];

/**
 * Reports whether a token is named by the compiled hardcore list.
 *
 * Planned: this universal membership helper has no production caller yet. The
 * engine currently receives the set it needs from the loader.
 */
export function isHardcoreToken(token: string): boolean {
  return HARDCORE_SERVICES.some((hardcore) => hardcore.token === token);
}
