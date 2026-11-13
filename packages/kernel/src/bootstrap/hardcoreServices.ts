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
  'a0b19b177faed122b6b0432244361bc2322f424d9d790d5223b0991ab33adcd4';
const IDENTITY_REGISTRY_BUILT_HASH =
  'f25f215d3dc02cf608ed636a66f294e9affe72eb33a73768c9e881f4731e5724';

/** Pinned digests of the exposed API registry package. */
const EXPOSED_API_REGISTRY_SOURCE_HASH =
  'ca2ade7e5f0ccbb59ec4c7e334a113cd96fc1ae5d3e7cbcb028eef468f47da54';
const EXPOSED_API_REGISTRY_BUILT_HASH =
  '98c207452b3f562b2bfcf9368701d5de0961d3874bb458b8d775766e8b554814';

/** Binding the identity registry records for one composed participant. */
interface IdentityBootBinding {
  readonly publisher: string;
  readonly contentHash: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/** Structural surface the identity registry's boot hook calls. */
interface IdentityBootSurface {
  issue(binding: IdentityBootBinding): unknown;
}

/** Structural surface the exposed API registry's boot hook calls. */
interface ExposedApiBootSurface {
  closeRegistration(): void;
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
    || typeof (instance as { readonly closeRegistration?: unknown }).closeRegistration !== 'function'
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
    // registry is still mutable.
    boot: (instance: unknown, context: HardcoreBootContext): void => {
      const registry = asIdentityBootSurface(instance, context.token);

      for (const entry of context.composition) {
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
  {
    token: 'brud.core.exposedApiRegistry',
    expectedContentHash: EXPOSED_API_REGISTRY_SOURCE_HASH,
    expectedBuiltContentHash: EXPOSED_API_REGISTRY_BUILT_HASH,
    contractVersion: '1.0.0',
    contractInterface: [
      'registerApi',
      'resolve',
      'resolveWithMetadata',
      'scopeOf',
      'closeRegistration',
      'isRegistrationOpen',
      'registeredApiNames',
      'registeredApiIdentities',
    ],
    // Seals the boot registration window before RUNNING. Sealing is
    // idempotent, so a composition whose registrant pass already sealed the
    // window observes no change.
    boot: (instance: unknown, context: HardcoreBootContext): void => {
      asExposedApiBootSurface(instance, context.token).closeRegistration();
    },
  },
];

/** Reports whether a token is named by the compiled hardcore list. */
export function isHardcoreToken(token: string): boolean {
  return HARDCORE_SERVICES.some((hardcore) => hardcore.token === token);
}
