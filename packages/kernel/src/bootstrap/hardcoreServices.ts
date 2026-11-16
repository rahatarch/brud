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
  '523fcbfa4828344974d9ec5db88f58edd24003790cd27fe34267a9287fe3729d';
const EXPOSED_API_REGISTRY_BUILT_HASH =
  '47a9c141c6586d081a08093b31f54d99676fdac6d8663759d2cd8bd16c97f2d2';

/** Pinned digests of the parser package. */
const PARSER_SOURCE_HASH =
  '47f283d3b7fc1bc5c5343e4bf029560822e77f28f58122c2693b98e0d8d0c38a';
const PARSER_BUILT_HASH =
  'b38c009b141eb7b15c8a0fd59529f75396c63f1a71f5eff264430dbf11998c6e';

/** Pinned digests of the router package. */
const ROUTER_SOURCE_HASH =
  '8a3addc9379350ee6405657f193088ac7fdc60ba9cd3bdd17a5ad2a845171a87';
const ROUTER_BUILT_HASH =
  'aafb6ecec238a88341c21b42edc5a1d837938d81b986bb072b0ed8345c99308b';

/**
 * Pinned digests of the WASM cage package.
 *
 * The source pin is computed by `computePackageContentHash` over the cage's
 * package graph, which includes the cage's built `.node` artifact as a binary
 * leaf. The built pin is recorded as needing a build: no built kernel has been
 * produced since the cage was added, so the value below is a placeholder that
 * a kernel build replaces.
 */
const WASM_CAGE_SOURCE_HASH =
  '9b7664499fd0ad62563f617990ea2a032b9b37051d68067acf83eabe183819fa';
const WASM_CAGE_BUILT_HASH =
  '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Pinned digests of the events hardcore package.
 *
 * The source pin is computed by `computePackageContentHash` over the events
 * package graph. The built pin is recorded as needing a build: no built kernel
 * has been produced since the events package was added, so the value below is a
 * placeholder that a kernel build replaces.
 */
const EVENTS_SOURCE_HASH =
  'e462f0c97bd6d46d696c05fbdbb12508200571688c3edfde0c254e7ef2068d43';
const EVENTS_BUILT_HASH =
  '0c865aeee5907bbd0de3f3616191728c203ecdfc9a515fce91a5213d0ce99842';

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
  {
    token: 'brud.core.parser',
    expectedContentHash: PARSER_SOURCE_HASH,
    expectedBuiltContentHash: PARSER_BUILT_HASH,
    contractVersion: '1.0.0',
    contractInterface: ['parse'],
    // The Parser performs no boot-time work. Its instance is ready once the
    // kernel initializes it; this hook only satisfies the uniform signature.
    boot: (_instance: unknown, _context: HardcoreBootContext): void => {
      void _instance;
      void _context;
    },
  },
  {
    token: 'brud.core.router',
    expectedContentHash: ROUTER_SOURCE_HASH,
    expectedBuiltContentHash: ROUTER_BUILT_HASH,
    contractVersion: '1.0.0',
    contractInterface: [
      'register',
      'closeRegistration',
      'isRegistrationOpen',
      'registeredKinds',
      'route',
      'dispatch',
    ],
    // The Router performs no boot-time work here. Its registration window is
    // opened by its descriptor and closed by its module's boot-registrant hook,
    // which the kernel calls after composed construction; this hook only
    // satisfies the uniform signature.
    boot: (_instance: unknown, _context: HardcoreBootContext): void => {
      void _instance;
      void _context;
    },
  },
  {
    token: 'brud.core.wasmCage',
    expectedContentHash: WASM_CAGE_SOURCE_HASH,
    expectedBuiltContentHash: WASM_CAGE_BUILT_HASH,
    contractVersion: '1.0.0',
    contractInterface: ['resolve'],
    // The cage is a mechanism, not an official participant: it holds the
    // participants the composition has not declared official. The identity-to-
    // official mapping reads this and maps the cage to non-official.
    mechanism: true,
    // The cage's boot hook binds the kernel's call authority so its `resolve`
    // can start a runtime-origin chain. It opens no participant-facing
    // registration, so the seal is a no-op.
    boot: (instance: unknown, context: HardcoreBootContext): void => {
      const cage = instance as { bindAuthority(value: KernelCallAuthority): void };
      cage.bindAuthority(context.authority);
    },
  },
  {
    token: 'brud.core.events',
    expectedContentHash: EVENTS_SOURCE_HASH,
    expectedBuiltContentHash: EVENTS_BUILT_HASH,
    contractVersion: '1.0.0',
    contractInterface: ['emit', 'pull', 'close', 'list'],
    // Events are a mechanism, not an official participant: the events hardcore
    // holds the declared events and carries deliveries; the participant that
    // declares an event is the giver. The identity-to-official mapping reads
    // this and maps the events hardcore to non-official.
    mechanism: true,
    // The events hardcore's boot hook binds the kernel's call authority so
    // later steps can reach `admitCall`/`observe`. It opens no participant-
    // facing registration.
    boot: (instance: unknown, context: HardcoreBootContext): void => {
      const events = instance as { bindAuthority(value: KernelCallAuthority): void };
      events.bindAuthority(context.authority);
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
