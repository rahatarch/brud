import type {
  ITerminalService,
  TerminalPolicy,
  TerminalValidatorPort,
  ValidationPolicy,
  ValidationService as KernelValidationService,
} from '@brud/kernel' with { 'resolution-mode': 'import' };
import { policyFromSettings } from '../api/validationFacade';
import { DEFAULT_SETTINGS } from '../settings/types';
import { getWorkspaceRootForPath } from '../utils/workspacePath';

/**
 * Process-wide binding of the kernel terminal authority for the legacy
 * terminal facade.
 *
 * The legacy executor is a module-level function surface without a kernel
 * handle, while the kernel service lives per kernel instance. Hosts bind the
 * instance here (`bootCoreKernel` does it), so `executeCommand`,
 * `killProcess` and `getActiveProcessIds` all delegate to one registry.
 */
let bound: ITerminalService | undefined;

/** Kernel terminal authority a standalone binding is created over. */
interface KernelTerminalAuthority {
  new (options?: {
    readonly workspaceRoot?: string;
    readonly policy?: TerminalPolicy;
    readonly validator?: TerminalValidatorPort;
  }): ITerminalService & { dispose?(): Promise<void> };
}

/** Kernel exports this module needs. */
interface KernelTerminalExports {
  readonly TerminalService: KernelTerminalAuthority;
  readonly DEFAULT_TERMINAL_POLICY: TerminalPolicy;
  readonly ValidationService: new (options: {
    readonly policy: ValidationPolicy;
    readonly workspace: {
      readonly roots: readonly string[];
      readonly primaryRoot: string;
      resolve(userPath: string): Promise<string>;
      toAbsolutePath(kernelPath: string): string;
    };
    readonly environment: { readonly homeDirectory: string; readonly flavor: 'posix' | 'win32' };
  }) => KernelValidationService;
}

/** Cached standalone authority for hosts that never bound one. */
let standalone: ITerminalService | undefined;

/** Cached validation authority of the standalone terminal. */
let standaloneValidator: KernelValidationService | undefined;

/** Workspace registry the standalone validation authority reads. */
let standaloneWorkspace: MutableWorkspace | undefined;

/**
 * Binds the terminal authority every legacy facade call delegates to.
 *
 * @param service - Kernel terminal service registered for this host.
 */
export function bindTerminalService(service: ITerminalService | undefined): void {
  bound = service;
}

/** The bound terminal authority, when a host bound one. */
export function getBoundTerminalService(): ITerminalService | undefined {
  return bound;
}

/**
 * Resolves the terminal authority.
 *
 * Standalone compositions (the historical `@brud/core` surface used without a
 * kernel) get a private kernel terminal instance on first use. Hosts that boot
 * a kernel always resolve the bound instance.
 *
 * The standalone instance is bound to a real validation authority: the kernel
 * terminal fails closed with `TERMINAL_UNAVAILABLE` unless one is attached, so
 * a validator-less binding would make every legacy call unusable.
 */
export function terminalAuthority(): ITerminalService {
  if (bound !== undefined) {
    return bound;
  }

  if (standalone === undefined) {
    const mod = requireKernel();
    // Legacy callers omitted `cwd` freely; the historical fallback was the
    // host process directory.
    standaloneValidator = createStandaloneValidator(mod);
    bindTerminalService(
      wrapStandalone(
        new mod.TerminalService({
          policy: { ...mod.DEFAULT_TERMINAL_POLICY, maxOutputBytes: STANDALONE_MAX_OUTPUT_BYTES },
          workspaceRoot: process.cwd(),
          validator: standaloneValidator,
        }),
      ),
    );
  }

  const service = bound;

  if (service === undefined) {
    throw new Error('terminal authority binding failed to initialize');
  }

  return service;
}

/**
 * Workspace registry the standalone validation authority reads on every call.
 *
 * The service holds this object, so registering a root here changes the next
 * containment decision without rebuilding the authority.
 */
interface MutableWorkspace {
  readonly roots: string[];
  readonly primaryRoot: string;
}

/** Standalone validation output ceiling, matching the kernel read governor. */
const STANDALONE_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

/**
 * Builds the validation authority of a standalone legacy terminal.
 *
 * The authority is a kernel `ValidationService` (the same engine the kernel
 * descriptor binds), so a command the legacy surface runs is gated by exactly
 * the rules a kernel-hosted terminal applies: the command scanner, the
 * containment boundary and the frozen policy. It is created through
 * `requireKernel` for the same reason the terminal is: a core-ESM caller only
 * needs the kernel when it actually executes.
 *
 * Only a standalone composition reaches this path. The host process directory
 * is the default root; a request that names its own `cwd` is admitted by
 * {@link admitStandaloneCwd}, which delegates to the one policy decision the
 * legacy boundary already owns (`BrudAPI.validate.cwd`). A bound kernel
 * terminal answers to the real workspace registry instead.
 *
 * @param mod - Kernel exports.
 */
function createStandaloneValidator(mod: KernelTerminalExports): KernelValidationService {
  const root = process.cwd();

  // The defaults are the historical fail-closed boundary policy: validation
  // on, containment on. A host that wants an operator override binds its own
  // kernel terminal authority instead of relying on this fallback.
  const policy = policyFromSettings(DEFAULT_SETTINGS);
  standaloneWorkspace = { roots: [root], primaryRoot: root };
  const service = new mod.ValidationService({
    policy,
    workspace: {
      roots: standaloneWorkspace.roots,
      primaryRoot: root,
      resolve: async (userPath: string) => getWorkspaceRootForPath(userPath, [root]) ?? root,
      toAbsolutePath: (kernelPath: string) => kernelPath,
    },
    environment: {
      homeDirectory: process.env.HOME ?? process.env.USERPROFILE ?? '/home',
      flavor: process.platform === 'win32' ? 'win32' : 'posix',
    },
  });

  return service;
}

/**
 * Admits a standalone request's working directory into the workspace shim.
 *
 * A standalone caller passes an absolute `cwd` that the host terms valid, so
 * the shim registers it as a root before the kernel gate re-checks
 * containment. This mirrors the legacy execution boundary, whose batch was
 * already validated against the caller's folder list: the shim only carries
 * that decision into the kernel authority. A bound kernel terminal never
 * reaches this path, so a hosted workspace keeps its exact root set.
 *
 * @param cwd - Requested working directory.
 */
function admitStandaloneCwd(cwd: string): void {
  const roots = standaloneWorkspace?.roots;

  if (roots === undefined || roots.includes(cwd)) {
    return;
  }

  roots.push(cwd);
}

/**
 * Wraps a standalone terminal so per-request `cwd` values reach the shim
 * before the kernel gate runs.
 *
 * @param service - Bare kernel terminal over the standalone shim.
 */
function wrapStandalone(service: ITerminalService): ITerminalService {
  const run: ITerminalService['run'] = (request, options) => {
    const cwd = readRequestCwd(request);

    if (cwd !== undefined) {
      admitStandaloneCwd(cwd);
    }

    return service.run(request, options);
  };

  return new Proxy(service, {
    get(target, property, receiver) {
      if (property === 'run') {
        return run;
      }

      const value = Reflect.get(target, property, receiver) as unknown;

      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

/**
 * Reads a request's working directory without trusting its shape.
 *
 * @param request - Untrusted request envelope.
 */
function readRequestCwd(request: unknown): string | undefined {
  if (typeof request !== 'object' || request === null) {
    return undefined;
  }

  const cwd = (request as { readonly cwd?: unknown }).cwd;

  return typeof cwd === 'string' && cwd.trim().length > 0 ? cwd : undefined;
}

/**
 * Loads the kernel terminal exports without a static value import.
 *
 * `@brud/kernel` is loaded on demand so hosts that only use filesystem
 * operations never pay for the terminal engine.
 */
function requireKernel(): KernelTerminalExports {
  const loaded: unknown = require('@brud/kernel');

  return loaded as KernelTerminalExports;
}
