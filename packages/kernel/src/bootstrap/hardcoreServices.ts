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
  '9b1b73ed6ad48cb910f5f584bf51984561455fe998f93790a06359fd69aa11c2';
const IDENTITY_REGISTRY_BUILT_HASH =
  'd30ee7fecfca06ad1f661a9125bb0eafa1d7750467c369ea59bd553bfe107fa1';

/** Pinned digests of the exposed API registry package. */
const EXPOSED_API_REGISTRY_SOURCE_HASH =
  'e025e0c9dad2b1471527ace37d102abe9366a6bd9f14014a29e1b11410a77240';
const EXPOSED_API_REGISTRY_BUILT_HASH =
  '1611d0706c145878d644f0549cab89856423c07351ebef5b209c26874677f8b0';

/** Pinned digests of the parser package. */
const PARSER_SOURCE_HASH =
  '0c7310dae93d06b08cfc34dfd275f09fb50a97a07338b635be52d8594e940431';
const PARSER_BUILT_HASH =
  '2b2520552e7652a0992677bd8607cbe0d4b798e4e629963a4a27727a851e3c37';

/** Pinned digests of the router package. */
const ROUTER_SOURCE_HASH =
  '32af5d7bb8cb4211a088fc1e33e0946a81d40377c40b5181b67f5ff36ddd7ee6';
const ROUTER_BUILT_HASH =
  '1235a251dfddcf3c336341b15e5016c6d46f560c98f0f65f3c64bd285db3fc84';

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
  '61719cb5818fb23f97103f7ee77461e437220e6c7791b222d48d116d706da00a';
const WASM_CAGE_BUILT_HASH =
  '2cf3f716e43e07879766e3e3d2623c44c4c052544cf3c5ecc38560506fdcb038';

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
  '000cdceb69078df0b99eda3af34e7e25b96c48fd8295b76397bb8a70f4916a38';
const INTERCEPTION_BUILT_HASH =
  '1b50d79c2ff245a73dd01e6b834c690e5063271f072cecd9f91e2c0521729f36';

const EVENTS_SOURCE_HASH =
  'd6966a6682b886c732002142d9d2446d96da5e47a370e20648c0130118a6312d';
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
    contractInterface: ['lastRefusal', 'register', 'resolve'],
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
      'kinds',
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
    contractInterface: ['evaluate', 'evaluateResult', 'list'],
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
