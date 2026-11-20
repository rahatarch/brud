import type { KernelCallAuthority } from '../contracts/callChain.js';
import type { EventDeclaration,
  KindDeclaration, ExposureDeclaration } from '../contracts/manifest.js';
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
  '40e3690aa8b3d97ea81f85212ec79ce2cc6b07e0843214d3679236b9881579cc';
const IDENTITY_REGISTRY_BUILT_HASH =
  'e169f2b42cfdc6d277bb01a164f569d29c03687bcfc50ccdce9f6ebf4f7f1895';

/** Pinned digests of the exposed API registry package. */
const EXPOSED_API_REGISTRY_SOURCE_HASH =
  '031bca28d929ba2c8184627d7e4d10c549b6856b952a0338d27743e936032286';
const EXPOSED_API_REGISTRY_BUILT_HASH =
  '1be233d60e6ae4d136531be3198bf5033f8b34b0cd4d8af9ca8a2563420b793f';

/** Pinned digests of the parser package. */
const PARSER_SOURCE_HASH =
  '14d746d06272a6156c6c557dc236d1ab266bdc0e9fd61c7c436978c2baa2558b';
const PARSER_BUILT_HASH =
  '2b2520552e7652a0992677bd8607cbe0d4b798e4e629963a4a27727a851e3c37';

/** Pinned digests of the router package. */
const ROUTER_SOURCE_HASH =
  '1d75e1db756669f98be8293c5df6747275abf5d1a53a8f71c2e564d0a545ca12';
const ROUTER_BUILT_HASH =
  'fda0abd1c31cc85c53277164478ab93cf24608dae78aa26d713af35b37b1630b';

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
  'ab79b775d3d1ddca13c84f8de39d56d19aa1cecb318df4de7ffdd5f5374ed7e8';
const WASM_CAGE_BUILT_HASH =
  '4fea387744a9ef01eca164c5c42fce50f3238be3b768befb7feee53eed1a1834';

/**
 * Pinned digests of the events hardcore package.
 *
 * The source pin is computed by `computePackageContentHash` over the events
 * package graph. The built pin is recorded as needing a build: no built kernel
 * has been produced since the events package was added, so the value below is a
 * placeholder that a kernel build replaces.
 */
/** Pinned digests of the interception package (recomputed with computePackageContentHash). */
const INTERCEPTION_SOURCE_HASH =
  '2be65138fd69574885b672a954f9c36eea38cc59693f5136b50fb610462cf11c';
const INTERCEPTION_BUILT_HASH =
  '372361ad9c50b00e5956319891b615f5f3397d911a0fd168438a34985153d960';

const EVENTS_SOURCE_HASH =
  '42673c2cb4e2d42143ebb6332e5a435dc035ebedb2e39c89eb1e8d9dc82586f0';
const EVENTS_BUILT_HASH =
  'b91fc7107e7c7ba65304262ffd6daf35dd7d5e2f64c6d8ec707db74348a41cfa';

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
    contractVersion: '2.0.0',
    contractInterface: [
      'register',
      'closeRegistration',
      'isRegistrationOpen',
      'registeredKinds',
      'route',
      'dispatch',
    ],
    // Binds the call chain. The registration window is opened by its
    // descriptor and closed by its module's boot-registrant hook, which the
    // kernel calls after composed construction.
    boot: (instance: unknown, context: HardcoreBootContext): void => {
      const router = instance as {
        bindAuthority(value: KernelCallAuthority): void;
        registerDeclared(owner: string, declaration: KindDeclaration): void;
      };
      // The Router reads the real caller from the kernel call chain.
      router.bindAuthority(context.authority);

      // Declared kinds (`manifest.kinds`): any participant, native or caged.
      for (const entry of context.composition) {
        if (entry.manifest.kinds.length === 0) {
          continue;
        }

        const owner = context.identityOf(entry.token);

        if (owner === undefined) {
          throw new TypeError(`Participant "${entry.token}" declares kinds but has no kernel identity`);
        }

        for (const declaration of entry.manifest.kinds) {
          router.registerDeclared(owner, declaration);
        }
      }
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
    contractInterface: ['emit', 'pull', 'close', 'list', 'subscribe'],
    // Events are a mechanism, not an official participant: the events hardcore
    // holds the declared events and carries deliveries; the participant that
    // declares an event is the giver. The identity-to-official mapping reads
    // this and maps the events hardcore to non-official.
    mechanism: true,
    // The events hardcore's boot hook binds the kernel's call authority and
    // populates its boot-time catalogue from each participant's
    // `manifest.events`.
    boot: (instance: unknown, context: HardcoreBootContext): void => {
      const events = instance as {
        bindAuthority(value: KernelCallAuthority): void;
        registerDeclaration(owner: string, declaration: EventDeclaration): void;
      };
      events.bindAuthority(context.authority);

      for (const entry of context.composition) {
        if (entry.manifest.events.length === 0) {
          continue;
        }

        const owner = context.identityOf(entry.token);

        if (owner === undefined) {
          throw new TypeError(
            `Participant "${entry.token}" declares events but has no kernel identity`,
          );
        }

        for (const declaration of entry.manifest.events) {
          events.registerDeclaration(owner, declaration);
        }
      }
    },
  },
  {
    token: 'brud.core.interception',
    expectedContentHash: INTERCEPTION_SOURCE_HASH,
    expectedBuiltContentHash: INTERCEPTION_BUILT_HASH,
    contractVersion: '1.0.0',
    contractInterface: ['evaluate', 'list'],
    // Interception is a mechanism: the giver of an interception point and the
    // admitted interceptors are the participants; the hardcore only pairs them
    // at boot and runs the verdicts.
    mechanism: true,
    boot: (instance: unknown, context: HardcoreBootContext): void => {
      const interception = instance as {
        bindAuthority(value: KernelCallAuthority): void;
        registerComposition(participants: readonly {
          readonly token: string;
          readonly identity: string | undefined;
          readonly manifest: HardcoreBootContext['composition'][number]['manifest'];
        }[]): void;
      };
      interception.bindAuthority(context.authority);
      interception.registerComposition(context.composition.map((entry) => ({
        token: entry.token,
        identity: context.identityOf(entry.token),
        manifest: entry.manifest,
      })));
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
