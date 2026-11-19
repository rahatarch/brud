/**
 * Boots the real kernel with the seven hardcores, BrudTools, and test
 * participants, using only `@brud/kernel`'s public API — what a third-party
 * developer has.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { ExposedApiRegistryToken, bootKernel, provisionIdentityRegistryStorage, type BrudKernel } from '@brud/kernel';

const HARDCORES = ['identityRegistry', 'exposedApiRegistry', 'parser', 'router', 'wasmCage', 'events', 'interception'];
const BRUD_TOOLS_MODULE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'serviceModule.ts');

/** A test participant: a full module source, or the parts of a plain native one. */
export interface TestParticipant {
  readonly token: string;
  readonly official?: boolean;
  readonly capabilities?: readonly string[];
  readonly exposures?: readonly Readonly<Record<string, unknown>>[];
  /** Object-literal source keyed `name@major` → `(caller) => handle`. */
  readonly bindings?: string;
  /** Body of an async `onRunning(broker)`; `registry` and `report` are in scope. */
  readonly onRunning?: string;
  /** A complete module source, replacing the generated one. */
  readonly source?: string;
  /** A caged participant as a participant package (W-01): module text and manifest. */
  readonly package?: { readonly wat: string; readonly manifest: Readonly<Record<string, unknown>> };
}

/** Shared report object participants write to. */
export function reports(): Record<string, Record<string, unknown>> {
  return ((globalThis as { __brudToolsTest?: Record<string, Record<string, unknown>> }).__brudToolsTest ??= {});
}

function moduleSource(participant: TestParticipant): string {
  const manifest = {
    requests: { capabilities: [...(participant.capabilities ?? [])] },
    exposures: [...(participant.exposures ?? [])],
    events: [],
  };

  return `const token = { id: ${JSON.stringify(participant.token)}, description: 'brud tools test participant', _brand: undefined };
const REGISTRY = { id: ${JSON.stringify(ExposedApiRegistryToken.id)}, description: 'registry', _brand: undefined };
const report = ((globalThis.__brudToolsTest ??= {})[token.id] ??= {});
const bindings = ${participant.bindings ?? '{}'};
export function createService() {
  return {
    token, tier: 'userland', dependencies: [],
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
          return bind ? { projection: (_service, caller) => bind(caller) } : undefined;
        },
        enumerable: false,
      });
      return instance;
    },
  };
}
`;
}

/**
 * Boots the kernel: hardcores, BrudTools, then the participants in order.
 *
 * @param t - The test context (teardown is registered on it).
 * @param participants - Test participants.
 * @returns The running kernel.
 */
export async function bootWithBrudTools(t: TestContext, participants: readonly TestParticipant[]): Promise<BrudKernel> {
  delete (globalThis as { __brudToolsTest?: unknown }).__brudToolsTest;
  const root = await mkdtemp(join(tmpdir(), 'brud-tools-'));
  let kernel: BrudKernel | undefined;

  t.after(async () => {
    if (kernel?.lifecycleState === 'RUNNING') {
      await kernel.shutdown();
    }

    await rm(root, { recursive: true, force: true });
  });

  const services: { path: string; official?: boolean }[] = [
    ...HARDCORES.map((name) => ({ path: `kernel:serviceModules/${name}.js`, official: true })),
    { path: BRUD_TOOLS_MODULE, official: true },
  ];

  for (const [index, participant] of participants.entries()) {
    if (participant.package !== undefined) {
      const directory = join(root, `participant-${String(index)}`);
      const module = Buffer.from(participant.package.wat, 'utf8');
      const path = join(directory, 'brud.participant.json');

      await mkdir(directory);
      await writeFile(join(directory, 'participant.wasm'), module);
      await writeFile(path, JSON.stringify({
        format: 1,
        id: participant.token,
        manifest: participant.package.manifest,
        cage: { module: 'participant.wasm', sha256: createHash('sha256').update(module).digest('hex') },
      }), 'utf8');
      services.push(participant.official === undefined ? { path } : { path, official: participant.official });
      continue;
    }

    const path = join(root, `participant-${String(index)}.mjs`);

    // Native participants run only when declared official (W-01).
    await writeFile(path, participant.source ?? moduleSource(participant), 'utf8');
    services.push({ path, official: participant.official ?? true });
  }

  const config = join(root, 'brud.config.json');

  await writeFile(config, JSON.stringify({ services }), 'utf8');
  provisionIdentityRegistryStorage(join(root, 'identity.json'));
  kernel = await bootKernel(config, { options: { 'identity.registry.path': join(root, 'identity.json'), 'router.root': root } });

  return kernel;
}
