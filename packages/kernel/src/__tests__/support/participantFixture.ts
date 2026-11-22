/**
 * Production-mirror participant fixture shared by the events and interception
 * tests: real `.mjs` participant modules, a real inline composition of the
 * hardcores plus the participants, real on-disk identity provisioning, and the
 * real `bootKernel`.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import {
  ExposedApiRegistryToken,
  bootKernel,
  provisionIdentityRegistryStorage,
  type BrudKernel,
} from '../../../index.js';

export interface FixtureParticipant {
  readonly token: string;
  readonly official?: boolean;
  readonly capabilities?: readonly string[];
  readonly exposures?: readonly Readonly<Record<string, unknown>>[];
  readonly events?: readonly Readonly<Record<string, unknown>>[];
  readonly bindings?: string;
  readonly onRunning?: string;
  readonly interceptions?: readonly Readonly<Record<string, unknown>>[];
  readonly interceptionPoints?: readonly Readonly<Record<string, unknown>>[];
  /** Source of an `intercept(call)` function, attached non-enumerably like `provideExposure`. */
  readonly intercept?: string;
  /** Source of an `interceptResult(call)` function (the output stage), attached the same way. */
  readonly interceptResult?: string;
  /** A complete participant module source; when set, it replaces the generated module. */
  readonly source?: string;
  /**
   * A caged participant, written as a participant package (W-01): the module
   * text (WAT or WASM) and its manifest. Not official unless `official` says so.
   */
  readonly package?: {
    readonly wat: string;
    readonly manifest: Readonly<Record<string, unknown>>;
    readonly limits?: Readonly<Record<string, number>>;
  };
}

/** WAT string literal for `text`. */
const watString = (text: string): string => `"${text.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;

/**
 * Writes a participant package (W-01) — the module text and a
 * `brud.participant.json` with its digest — and returns the package path.
 */
export async function writeParticipantPackage(
  directory: string,
  id: string,
  manifest: Readonly<Record<string, unknown>>,
  wat: string,
  limits?: Readonly<Record<string, number>>,
): Promise<string> {
  const module = Buffer.from(wat, 'utf8');
  const packagePath = join(directory, 'brud.participant.json');

  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'participant.wasm'), module);
  await writeFile(packagePath, JSON.stringify({
    format: 1,
    id,
    manifest,
    cage: {
      module: 'participant.wasm',
      sha256: createHash('sha256').update(module).digest('hex'),
      ...(limits === undefined ? {} : { limits }),
    },
  }), 'utf8');

  return packagePath;
}

/**
 * A caged probe: on start, makes each routed call (`{ name, method, args }`)
 * through `brud.call` and ignores the answers. What a non-official caller can
 * reach is observed on the giver's side.
 */
export function probeGuest(requests: readonly Readonly<Record<string, unknown>>[]): string {
  let offset = 0;
  const data: string[] = [];
  const calls: string[] = [];

  for (const request of requests) {
    const text = JSON.stringify(request);

    data.push(`(data (i32.const ${String(offset)}) ${watString(text)})`);
    calls.push(`(drop (call $call (i32.const ${String(offset)}) (i32.const ${String(Buffer.byteLength(text))})))`);
    offset += Buffer.byteLength(text) + 8;
  }

  return `(module
  (import "brud" "call" (func $call (param i32 i32) (result i64)))
  (memory (export "memory") 1)
  ${data.join('\n  ')}
  (data (i32.const 60000) ${watString('{"ok":true}')})
  (func (export "brud_alloc") (param i32) (result i32) (i32.const 32768))
  (func (export "brud_start") (param i32 i32) (result i64)
    ${calls.join('\n    ')}
    (i64.or (i64.shl (i64.const 60000) (i64.const 32)) (i64.const 11))))`;
}

export function fixtureModule(participant: FixtureParticipant): string {
  const manifest = {
    requests: { capabilities: [...(participant.capabilities ?? [])] },
    exposures: [...(participant.exposures ?? [])],
    events: [...(participant.events ?? [])],
    ...(participant.interceptions === undefined ? {} : { interceptions: [...participant.interceptions] }),
    ...(participant.interceptionPoints === undefined ? {} : { interceptionPoints: [...participant.interceptionPoints] }),
  };

  return `const token = { id: ${JSON.stringify(participant.token)}, description: 'events declaration fixture', _brand: undefined };
const REGISTRY = { id: ${JSON.stringify(ExposedApiRegistryToken.id)}, description: 'resolution primitive', _brand: undefined };
const report = (globalThis.__eventsDeclarationFixture ??= {})[token.id] ??= {};
const bindings = ${participant.bindings ?? '{}'};

export function createService() {
  return {
    token,
    tier: 'userland',
    dependencies: [],
    manifest: ${JSON.stringify(manifest)},
    factory: () => {
      const instance = {
        async onRunning(broker) {
          const registry = broker.requestAccess({ callerId: token.id, tier: 'userland', options: {} }, REGISTRY);
          ${participant.onRunning ?? ''}
        },
      };
      Object.defineProperty(instance, 'provideExposure', {
        value: (name, major) => {
          const bind = bindings[name + '@' + String(major)];
          if (!bind) return null;
          return { projection: (_service, caller) => (typeof bind === 'function' ? bind(caller) : bind) };
        },
        enumerable: false,
      });
      ${participant.intercept === undefined ? '' : `Object.defineProperty(instance, 'intercept', { value: ${participant.intercept}, enumerable: false });`}
      ${participant.interceptResult === undefined ? '' : `Object.defineProperty(instance, 'interceptResult', { value: ${participant.interceptResult}, enumerable: false });`}
      return instance;
    },
  };
}
`;
}

export interface FixtureComposition {
  readonly configPath: string;
  readonly options: Readonly<Record<string, unknown>>;
  readonly kernels: BrudKernel[];
}

export async function writeComposition(
  t: TestContext,
  participants: readonly FixtureParticipant[],
): Promise<FixtureComposition> {
  const root = await mkdtemp(join(tmpdir(), 'brud-events-declaration-'));
  const kernels: BrudKernel[] = [];

  t.after(async () => {
    for (const kernel of kernels.splice(0)) {
      if (kernel.lifecycleState === 'RUNNING') {
        await kernel.shutdown();
      }
    }

    await rm(root, { recursive: true, force: true });
  });

  const identityPath = join(root, 'identity-registry.json');
  provisionIdentityRegistryStorage(identityPath);

  const services: { path: string; official?: boolean }[] = [
    { path: 'kernel:serviceModules/identityRegistry.js', official: true },
    { path: 'kernel:serviceModules/exposedApiRegistry.js', official: true },
    { path: 'kernel:serviceModules/parser.js', official: true },
    { path: 'kernel:serviceModules/router.js', official: true },
    { path: 'kernel:serviceModules/wasmCage.js', official: true },
    { path: 'kernel:serviceModules/events.js', official: true },
    { path: 'kernel:serviceModules/interception.js', official: true },
  ];

  for (const [index, participant] of participants.entries()) {
    if (participant.package !== undefined) {
      const packagePath = await writeParticipantPackage(
        join(root, `participant-${String(index)}`),
        participant.token,
        participant.package.manifest,
        participant.package.wat,
        participant.package.limits,
      );

      services.push(participant.official === undefined ? { path: packagePath } : { path: packagePath, official: participant.official });
      continue;
    }

    const modulePath = join(root, `participant-${String(index)}.mjs`);

    // Native participants run only when declared official (W-01); test
    // participants are trusted test code, so they default to official.
    await writeFile(modulePath, participant.source ?? fixtureModule(participant), 'utf8');
    services.push({ path: modulePath, official: participant.official ?? true });
  }

  const configPath = join(root, 'brud.config.json');
  await writeFile(configPath, JSON.stringify({ services }, null, 2), 'utf8');

  return {
    configPath,
    options: { 'identity.registry.path': identityPath, 'router.root': root },
    kernels,
  };
}

export async function bootComposition(composition: FixtureComposition): Promise<BrudKernel> {
  const kernel = await bootKernel(composition.configPath, { options: composition.options });

  composition.kernels.push(kernel);

  return kernel;
}

export function fixtureReports(): Record<string, Record<string, unknown>> {
  return (globalThis as { __eventsDeclarationFixture?: Record<string, Record<string, unknown>> })
    .__eventsDeclarationFixture ?? {};
}

export function resetFixtureReports(): void {
  delete (globalThis as { __eventsDeclarationFixture?: unknown }).__eventsDeclarationFixture;
}

