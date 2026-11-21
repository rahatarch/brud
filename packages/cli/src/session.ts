import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type * as Daemon from '@brud/daemon';
import { flagText, type ParsedArgs } from './args.js';
import { asHost, bootIn, parseOptions, type KernelPackage } from './composition.js';
import { CommandError } from './errors.js';
import type { Io } from './io.js';
import { loadPackage } from './project.js';

/** A running kernel the CLI can send Brud text to, in-process or through the daemon. */
export interface Session {
  /** One line saying what is running. */
  readonly description: string;
  kinds(): Promise<readonly { readonly kind: string; readonly description?: string }[]>;
  route(text: string): Promise<{ readonly status?: string }>;
  close(): Promise<void>;
}

/** Flags that choose and shape a session (shared by `run` and `call`). */
export const SESSION_FLAGS = { boolean: ['daemon'], value: ['config', 'state', 'tier'], repeat: ['cap', 'option'] } as const;

async function loadKernel(io: Io): Promise<KernelPackage> {
  try {
    return await loadPackage('@brud/kernel', io.cwd);
  } catch {
    throw new CommandError('PACKAGE_NOT_FOUND', '@brud/kernel is not installed here. Run `npm install @brud/kernel @brud/sdk` in your project.');
  }
}

/** Boots the composition in-process, with state in `--state` (default `.brud/state` beside the composition). */
async function openKernel(io: Io, args: ParsedArgs, configPath: string): Promise<Session> {
  const kernel = await loadKernel(io);
  const state = resolve(io.cwd, flagText(args, 'state') ?? join(dirname(configPath), '.brud', 'state'));
  const capabilities = args.lists.get('cap') ?? [];

  await mkdir(state, { recursive: true });

  const booted = await bootIn(kernel, configPath, state, parseOptions(args.lists.get('option') ?? []));

  return {
    description: `kernel booted from ${configPath} (state: ${state}; host capabilities: ${capabilities.length === 0 ? 'none' : capabilities.join(', ')})`,
    kinds: () => asHost(kernel, booted, capabilities, (_registry, syntax) => (syntax === null ? [] : JSON.parse(JSON.stringify(syntax.kinds())) as { kind: string }[])),
    route: (text) => asHost(kernel, booted, capabilities, (_registry, syntax) => {
      if (syntax === null) {
        throw new CommandError('ROUTER_UNAVAILABLE', 'this composition has no syntax.route exposure');
      }

      return syntax.route(text) as Promise<{ status?: string }>;
    }),
    close: async () => {
      if (booted.lifecycleState === 'RUNNING') {
        await booted.shutdown();
      }
    },
  };
}

/**
 * Starts the daemon in this process (so this process is the one peer it admits)
 * and talks to it with the ordinary client, token files and handshake included.
 */
async function openDaemon(io: Io, args: ParsedArgs, configPath: string): Promise<Session> {
  const daemon = await loadPackage<typeof Daemon>('@brud/daemon', io.cwd).catch(() => {
    throw new CommandError('PACKAGE_NOT_FOUND', '@brud/daemon is not installed here. Run `npm install @brud/daemon` to use --daemon.');
  });
  const home = resolve(io.cwd, flagText(args, 'home') ?? io.env.BRUD_DAEMON_HOME ?? join(homedir(), '.brud'));
  const tier = flagText(args, 'tier') ?? 'ui';

  if (tier !== 'ui' && tier !== 'ai') {
    throw new CommandError('USAGE', '--tier must be ui or ai');
  }

  await mkdir(home, { recursive: true });

  const operatorConfig = join(home, daemon.module.OPERATOR_CONFIG_FILE);

  if (!existsSync(operatorConfig)) {
    // A safe default: nothing the client may set, no capabilities granted to any principal.
    await writeFile(operatorConfig, `${JSON.stringify({ composition: configPath, fixedOptions: {}, clientOptions: [], principals: { ui: [], ai: [] }, reuseIdenticalBoots: false }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    io.err(`wrote ${operatorConfig} (no client capabilities); edit it to grant any\n`);
  }

  const running = await daemon.module.createDaemon({ home, expectedPeerPid: process.pid });
  const client = await daemon.module.connectToDaemon({ home, tier, spawnIfMissing: false });
  const booted = await client.request<{ instance: { instanceId: string } }>('kernel.boot', { options: parseOptions(args.lists.get('option') ?? []) });
  const instanceId = booted.instance.instanceId;

  return {
    description: `daemon at ${running.endpoint.socketPath} (home: ${running.endpoint.home}, tier: ${tier}), kernel instance ${instanceId}`,
    kinds: async () => (await client.request<{ kinds: { kind: string }[] }>('kernel.kinds', { instanceId })).kinds,
    route: (text) => client.request<{ status?: string }>('kernel.route', { instanceId, text }),
    close: async () => {
      await client.request('kernel.dispose', { instanceId }).catch(() => undefined);
      await client.close();
      await running.shutdown();
    },
  };
}

/** Opens a kernel session: in-process by default, through the daemon with `--daemon`. */
export function openSession(io: Io, args: ParsedArgs, configPath: string, useDaemon: boolean): Promise<Session> {
  if (!existsSync(configPath)) {
    throw new CommandError('CONFIG_READ', `no composition at ${configPath}. Run \`brud init\`, or pass --config <path>.`);
  }

  return useDaemon ? openDaemon(io, args, configPath) : openKernel(io, args, configPath);
}
