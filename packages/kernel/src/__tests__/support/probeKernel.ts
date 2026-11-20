/**
 * Boots a real kernel from the hardcore services plus throwaway probe
 * participants, each owning one operation kind. Nothing here names a
 * Foundation service, plugin, or tool.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { ExposedApiRegistryToken, bootKernel, type BrudKernel } from '../../../index.js';
import { workspaceContextOptions } from './workspaceContext.js';

const HARDCORES = ['identityRegistry', 'exposedApiRegistry', 'parser', 'router', 'wasmCage', 'events', 'interception']
  .map((name) => ({ path: `kernel:serviceModules/${name}.js`, official: true }));

// A file:// URL, not a path: a raw Windows path is not a valid import specifier.
const PROBE_FIXTURE = new URL('../fixtures/probeParticipant.ts', import.meta.url).href;

export interface RouteOptions {
  readonly signal?: AbortSignal;
  readonly stopOnFailure?: boolean;
  readonly dryRun?: boolean;
  readonly maxOperations?: number;
}

export interface RouteOutcome {
  readonly status: string;
  readonly error?: string;
  readonly result?: { readonly status: string; readonly data?: Record<string, unknown>; readonly error?: unknown };
}

export interface RouteResult {
  readonly status: string;
  readonly operations: readonly RouteOutcome[];
  readonly dispatched: number;
  readonly failed: number;
  readonly parseError?: { readonly code: string; readonly friendly: string };
}

export interface ProbeKernel {
  readonly kernel: BrudKernel;
  readonly root: string;
  /** Routes Brud syntax as a host call with the given capabilities. */
  readonly route: (text: string, options?: RouteOptions, capabilities?: readonly string[]) => Promise<RouteResult>;
  /** Parses Brud syntax through the Parser's public exposure. */
  readonly parse: (text: string) => Promise<{ readonly ok: boolean; readonly operations?: readonly unknown[]; readonly error?: { readonly code: string; readonly friendly: string } }>;
}

/** The text of a Brud document holding the given blocks. */
export function brud(...blocks: readonly string[]): string {
  return ['[BRUD]', ...blocks, '[/BRUD]'].join('\n');
}

/** One `[CALL <kind> <operation>]` block. */
export function call(kind: string, operation: string, ...body: readonly string[]): string {
  return [`[CALL ${kind} ${operation}]`, ...body, '[END]'].join('\n');
}

/** Writes a participant module that owns `kind`, and returns its path. */
export async function writeProbeModule(root: string, kind: string, file = `probe-${kind}.mjs`): Promise<string> {
  const path = join(root, file);

  await writeFile(path, `import { createProbeDescriptor } from ${JSON.stringify(PROBE_FIXTURE)};
export const createService = (context) => createProbeDescriptor(context, { kind: ${JSON.stringify(kind)} });
`, 'utf8');

  return path;
}

/** Writes a composition of the hardcores plus the given participant modules. */
export async function writeComposition(root: string, modulePaths: readonly string[]): Promise<string> {
  const configPath = join(root, 'brud.config.json');

  await writeFile(configPath, JSON.stringify({
    services: [...HARDCORES, ...modulePaths.map((path) => ({ path, official: true }))],
    plugins: [],
  }), 'utf8');

  return configPath;
}

/** Makes a temporary root that is removed after the test. */
export async function probeRoot(
  t: TestContext,
  prefix = 'brud-probe-kernel-',
  beforeRemove?: () => Promise<void>,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));

  t.after(async () => {
    await beforeRemove?.();
    await rm(root, { recursive: true, force: true });
  });

  return root;
}

/** Boots the hardcores plus one probe participant per kind. */
export async function bootProbeKernel(
  t: TestContext,
  kinds: readonly string[] = ['probe'],
): Promise<ProbeKernel> {
  let running: { shutdown(): Promise<unknown> } | undefined;
  const root = await probeRoot(t, undefined, async () => {
    await running?.shutdown().catch(() => undefined);
  });
  const modules = await Promise.all(kinds.map((kind) => writeProbeModule(root, kind)));
  const configPath = await writeComposition(root, modules);
  const kernel = await bootKernel(configPath, { options: { ...workspaceContextOptions(root) } });

  running = kernel;

  const inHost = <T,>(
    capabilities: readonly string[],
    run: (exposures: { readonly router: Router; readonly parser: Parser }) => Promise<T> | T,
  ): Promise<T> =>
    kernel.runHostCall({ capabilities: [...capabilities] }, async () => {
      const registry = kernel.requestAccess({ callerId: 'acme.test.host', tier: 'core', options: {} }, ExposedApiRegistryToken);
      const router = registry.resolve<Router>('syntax.route');
      const parser = registry.resolve<Parser>('syntax.parse');

      if (router === null || parser === null) {
        throw new Error('the syntax exposures are not resolvable');
      }

      return run({ router, parser });
    }) as Promise<T>;

  return {
    kernel,
    root,
    route: (text, options, capabilities = []) =>
      inHost(capabilities, async ({ router }) => (await router.route(text, options)) as RouteResult),
    parse: (text) => inHost([], ({ parser }) => parser.parse(text) as never),
  };
}

interface Router {
  route(text: string, options?: RouteOptions): Promise<unknown>;
  registeredKinds(): readonly string[];
}

interface Parser {
  parse(text: string): unknown;
}
