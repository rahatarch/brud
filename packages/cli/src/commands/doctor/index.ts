import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type * as Daemon from '@brud/daemon';
import { flagText, type ParsedArgs } from '../../core/args.js';
import { analyzeComposition } from '../../composition/analyze.js';
import {
  bootFailure,
  hardcoreModulePaths,
  parseOptions,
  resolveConfigPath,
  withScratchKernel,
  type KernelPackage,
} from '../../composition/load.js';
import { describeError } from '../../core/errors.js';
import type { Io } from '../../core/io.js';
import { isInstalled, loadPackage, readOwnPackage, satisfies } from '../../core/project.js';
import { hasFailure, printFindings, type Finding, type Style } from '../../core/report.js';

export const DOCTOR_FLAGS = { repeat: ['option'] } as const;

function nodeFinding(): Finding {
  const range = readOwnPackage().engines.node;
  const have = process.versions.node;

  return satisfies(have, range)
    ? { id: 'node', title: `Node.js ${have} (needs ${range})`, status: 'pass' }
    : { id: 'node', title: `Node.js ${have} (needs ${range})`, status: 'fail', cause: `Node ${have} is older than the supported range`, fix: 'Install Node.js 22 or newer (for example with nvm or fnm).' };
}

/** The platform suffix the cage's native binary carries (`linux-x64`, `darwin-arm64`, `win32-x64`). */
function cageTarget(): string {
  return `${process.platform}-${process.arch}`;
}

function cageFinding(kernel: KernelPackage): Finding {
  const target = cageTarget();
  const folders = [join(kernel.root, 'services', 'WasmCage', 'native'), join(kernel.root, 'dist', 'services', 'WasmCage', 'native')];
  const found = folders.some((folder) => existsSync(folder) && readdirNames(folder).some((name) => name.endsWith('.node') && name.includes(target)));

  return found
    ? { id: 'cage', title: `A WASM cage binary exists for ${target}`, status: 'pass' }
    : { id: 'cage', title: `A WASM cage binary exists for ${target}`, status: 'fail', cause: 'WASM_CAGE_NATIVE_UNAVAILABLE: this kernel install ships no cage binary for this platform', fix: 'Reinstall @brud/kernel on this machine; if your platform is unsupported, native official participants still run but caged ones cannot.' };
}

function readdirNames(folder: string): string[] {
  try {
    return readdirSync(folder);
  } catch {
    return [];
  }
}

async function hardcoreFinding(kernel: KernelPackage): Promise<Finding> {
  const title = 'Every hardcore service verifies against its pinned content hash';
  const scratch = await mkdtemp(join(tmpdir(), 'brud-cli-hardcore-'));

  try {
    const configPath = join(scratch, 'brud.config.json');

    await writeFile(configPath, JSON.stringify({ services: hardcoreModulePaths(kernel.root).map((path) => ({ path, official: true })) }), 'utf8');
    await withScratchKernel(kernel, configPath, {}, async () => undefined);

    return { id: 'hardcore.verify', title, status: 'pass' };
  } catch (error: unknown) {
    return bootFailure('hardcore.verify', title, error);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function daemonFindings(io: Io, home: string): Promise<Finding[]> {
  if (!existsSync(home)) {
    return [{ id: 'daemon.home', title: `Daemon home ${home} does not exist yet`, status: 'info', cause: 'it is created the first time you run `brud run --daemon`; nothing to fix unless you use the daemon' }];
  }

  const findings: Finding[] = [{ id: 'daemon.home', title: `Daemon home ${home} exists`, status: 'pass' }];

  if (!isInstalled('@brud/daemon', io.cwd)) {
    return [...findings, { id: 'daemon.package', title: '@brud/daemon is not installed here, so the daemon was not checked', status: 'info', fix: 'Run `npm install @brud/daemon` to use the daemon.' }];
  }

  const daemon = await loadPackage<typeof Daemon>('@brud/daemon', io.cwd);
  const configPath = join(home, daemon.module.OPERATOR_CONFIG_FILE);

  if (!existsSync(configPath)) {
    findings.push({ id: 'daemon.config', title: `No ${daemon.module.OPERATOR_CONFIG_FILE} in the daemon home`, status: 'info', cause: 'the daemon needs one to start', fix: '`brud run --daemon` writes a safe one (no client capabilities) when it is missing.' });
  } else {
    try {
      const config = daemon.module.loadOperatorConfig(home);

      findings.push(existsSync(config.composition)
        ? { id: 'daemon.config', title: `${daemon.module.OPERATOR_CONFIG_FILE} is valid and its composition resolves`, status: 'pass' }
        : { id: 'daemon.config', title: `${daemon.module.OPERATOR_CONFIG_FILE} is valid`, status: 'fail', cause: `composition ${config.composition} does not exist (relative paths resolve from the ${daemon.module.OPERATOR_CONFIG_FILE} folder)`, fix: 'Point "composition" at your brud.config.json.' });
    } catch (error: unknown) {
      findings.push({ id: 'daemon.config', title: `${daemon.module.OPERATOR_CONFIG_FILE} is valid`, status: 'fail', cause: describeError(error).message, fix: 'Fix the file; composition, fixedOptions, clientOptions, principals and reuseIdenticalBoots are the only keys.' });
    }
  }

  if (process.platform === 'win32') {
    return [...findings, { id: 'daemon.tokens', title: 'Token file permissions are managed by Windows ACLs and were not checked', status: 'info' }];
  }

  try {
    const endpoint = await daemon.module.resolveEndpoint(home);
    const tokens = [endpoint.tokenPath, endpoint.aiTokenPath].filter((path) => existsSync(path));
    const loose = tokens.filter((path) => (statSync(path).mode & 0o077) !== 0);

    findings.push(loose.length > 0
      ? { id: 'daemon.tokens', title: 'Token files are owner-only', status: 'fail', cause: `${loose.join(', ')} can be read by other users`, fix: `Run chmod 600 on them, or delete them so the daemon issues fresh ones.` }
      : { id: 'daemon.tokens', title: tokens.length === 0 ? 'No token files yet (created when the daemon starts)' : 'Token files are owner-only', status: tokens.length === 0 ? 'info' : 'pass' });
  } catch (error: unknown) {
    findings.push({ id: 'daemon.tokens', title: 'Token files are owner-only', status: 'fail', cause: describeError(error).message, fix: 'Fix the runtime directory named in the cause (it must be owned by you and mode 700).' });
  }

  return findings;
}

/**
 * `brud doctor`: a read-only check of this machine and, when there is one, the
 * composition and the daemon. It writes only inside throw-away scratch folders.
 */
export async function runDoctor(io: Io, style: Style, args: ParsedArgs): Promise<number> {
  const configPath = resolveConfigPath(io.cwd, args.positionals[0] ?? flagText(args, 'config'));
  const inProject = existsSync(configPath);
  const home = flagText(args, 'home') ?? io.env.BRUD_DAEMON_HOME ?? join(homedir(), '.brud');
  const findings: Finding[] = [nodeFinding()];
  let kernel: KernelPackage | undefined;

  try {
    kernel = await loadPackage('@brud/kernel', io.cwd);
    findings.push({ id: 'kernel', title: `@brud/kernel ${kernel.version} found at ${kernel.root}`, status: 'pass' });
  } catch {
    findings.push({ id: 'kernel', title: '@brud/kernel was not found from here', status: inProject ? 'fail' : 'warn', cause: inProject ? 'this project has a composition but no kernel installed' : 'you are not in a Brud project (that is fine for `brud init`)', fix: 'Run `npm install @brud/kernel @brud/sdk`, or `brud init <name>` to start a project.' });
  }

  for (const name of ['@brud/sdk', '@brud/daemon']) {
    if (kernel === undefined) {
      break;
    }

    if (!isInstalled(name, io.cwd)) {
      findings.push({ id: name, title: `${name} is not installed here`, status: 'info', fix: `Run \`npm install ${name}\` when you need it.` });
      continue;
    }

    const loaded = await loadPackage<unknown>(name, io.cwd);
    const peer = (JSON.parse(readFileSync(join(loaded.root, 'package.json'), 'utf8')) as { peerDependencies?: Record<string, string>; dependencies?: Record<string, string> });
    const range = peer.peerDependencies?.['@brud/kernel'] ?? peer.dependencies?.['@brud/kernel'];

    findings.push(range === undefined || satisfies(kernel.version, range)
      ? { id: name, title: `${name} ${loaded.version} matches the installed kernel`, status: 'pass' }
      : { id: name, title: `${name} ${loaded.version} matches the installed kernel`, status: 'warn', cause: `${name} wants @brud/kernel ${range} but ${kernel.version} is installed`, fix: `Align the versions: \`npm install @brud/kernel@latest ${name}@latest\`.` });
  }

  if (kernel !== undefined) {
    findings.push(cageFinding(kernel), await hardcoreFinding(kernel));

    if (inProject) {
      findings.push(...(await analyzeComposition(kernel, configPath, parseOptions(args.lists.get('option') ?? []))).findings);
    } else {
      findings.push({ id: 'composition', title: `No composition at ${configPath}, so no project checks ran`, status: 'info', fix: 'Run `brud init <name>`, or run doctor from a project folder.' });
    }
  }

  findings.push(...(await daemonFindings(io, home)));

  printFindings(io, style, findings, { cwd: io.cwd });

  return hasFailure(findings) ? 1 : 0;
}
