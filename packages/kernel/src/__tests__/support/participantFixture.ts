/**
 * Production-mirror participant fixture shared by the events and interception
 * tests: real `.mjs` participant modules, a real inline composition of the
 * hardcores plus the participants, real on-disk identity provisioning, and the
 * real `bootKernel`.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
    const modulePath = join(root, `participant-${String(index)}.mjs`);

    await writeFile(modulePath, fixtureModule(participant), 'utf8');
    services.push(participant.official === undefined
      ? { path: modulePath }
      : { path: modulePath, official: participant.official });
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

