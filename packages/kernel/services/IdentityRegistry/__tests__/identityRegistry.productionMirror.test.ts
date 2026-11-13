import { appendFileSync, existsSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
  BrudConfigError,
  bootKernel,
  type BrudConfig,
  type BrudConfigEntry,
} from '../../../src/bootstrap/index.js';
import type { ServiceContext } from '../../../src/contracts/lifecycle.js';
import type { BrudKernel } from '../../../src/engine/BrudKernel.js';
import {
  IDENTITY_BOOT_ISSUER_TOKEN,
  type IIdentityBootIssuerProbe,
  type IdentityBootIssuerScript,
} from '../../../src/__tests__/fixtures/identityRegistryBootIssuer.js';
import { workspaceContextOptions } from '../../../src/__tests__/support/workspaceContext.js';
import {
  IdentityRegistryCorruptError,
  IdentityRegistryFrozenError,
  IdentityRegistryMissingError,
  IdentityRegistryToken,
  provisionIdentityRegistryStorage,
  type IdentityBinding,
  type IIdentityRegistry,
} from '../index.js';

const KERNEL_CONFIG_PATH = fileURLToPath(
  new URL('../../../brud.config.json', import.meta.url),
);
const BOOT_ISSUER_MODULE_PATH = fileURLToPath(
  new URL(
    '../../../src/__tests__/fixtures/identityRegistryBootIssuer.ts',
    import.meta.url,
  ),
);

let baseServicesCache: Promise<readonly BrudConfigEntry[]> | undefined;

function baseServices(): Promise<readonly BrudConfigEntry[]> {
  baseServicesCache ??= readFile(KERNEL_CONFIG_PATH, 'utf8').then(
    (raw) => (JSON.parse(raw) as BrudConfig).services,
  );

  return baseServicesCache;
}

interface IdentityWorkspace {
  /** Temporary parent that owns the workspace and the operator state. */
  readonly root: string;

  /** Real workspace root used by the kernel composition. */
  readonly workspaceRoot: string;

  /** Registry storage outside the participant-writable workspace. */
  readonly storagePath: string;

  /** Real config document that composes the registry. */
  readonly configPath: string;
}

function storagePathFor(workspace: IdentityWorkspace): string {
  return workspace.storagePath;
}

function caller(workspace: IdentityWorkspace): ServiceContext {
  return {
    callerId: 'identity.registry.test',
    tier: 'core',
    options: {
      ...workspaceContextOptions(workspace.workspaceRoot),
      'identity.registry.path': storagePathFor(workspace),
    },
  };
}

function bootOptions(
  workspace: IdentityWorkspace,
  script: IdentityBootIssuerScript,
): Record<string, unknown> {
  return {
    ...workspaceContextOptions(workspace.workspaceRoot),
    'identity.registry.path': storagePathFor(workspace),
    history: { inMemory: true },
    'identity.fixture': script,
  };
}

async function createWorkspace(context: TestContext): Promise<IdentityWorkspace> {
  const root = await mkdtemp(join(tmpdir(), 'brud-identity-registry-'));
  const workspaceRoot = join(root, 'workspace');
  const operatorRoot = join(root, 'operator-state');

  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(operatorRoot, { recursive: true });

  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  return {
    root,
    workspaceRoot,
    storagePath: join(operatorRoot, 'registry.json'),
    configPath: join(root, 'brud.config.json'),
  };
}

async function writeIdentityConfig(workspace: IdentityWorkspace): Promise<string> {
  const services = [...await baseServices()];

  if (!services.some((entry) => entry.path === 'kernel:serviceModules/identityRegistry.js')) {
    services.push({ path: 'kernel:serviceModules/identityRegistry.js', official: true });
  }

  services.push({ path: BOOT_ISSUER_MODULE_PATH });

  const config = {
    services,
    plugins: [],
  };

  await writeFile(workspace.configPath, JSON.stringify(config, null, 2), 'utf8');

  return workspace.configPath;
}

async function bootIdentityKernel(
  context: TestContext,
  workspace: IdentityWorkspace,
  script: IdentityBootIssuerScript,
): Promise<BrudKernel> {
  const kernel = await bootKernel(workspace.configPath, {
    options: bootOptions(workspace, script),
  });

  context.after(async () => {
    if (kernel.lifecycleState === 'RUNNING') {
      await kernel.shutdown().catch(() => undefined);
    }
  });

  return kernel;
}

function requireToken(tokens: Readonly<Record<string, string>>, key: string): string {
  const token = tokens[key];

  if (token === undefined) {
    throw new Error(`The boot issuer did not record a token for "${key}"`);
  }

  return token;
}

function registryOf(kernel: BrudKernel, workspace: IdentityWorkspace): IIdentityRegistry {
  return kernel.requestAccess<IIdentityRegistry>(
    caller(workspace),
    IdentityRegistryToken,
  );
}

function probeOf(kernel: BrudKernel, workspace: IdentityWorkspace): IIdentityBootIssuerProbe {
  return kernel.requestAccess<IIdentityBootIssuerProbe>(
    caller(workspace),
    IDENTITY_BOOT_ISSUER_TOKEN,
  );
}

function isProtectedPathError(error: unknown): boolean {
  return error instanceof BrudConfigError && error.code === 'CONFIG_INTEGRITY';
}

describe('Identity Registry production mirror', () => {
  it('issues stable opaque tokens, freezes at RUNNING, and persists across a real restart', async (t) => {
    const workspace = await createWorkspace(t);
    const storagePath = workspace.storagePath;

    provisionIdentityRegistryStorage(storagePath);
    await writeIdentityConfig(workspace);

    const first = await bootIdentityKernel(t, workspace, {
      issue: [
        {
          key: 'alpha',
          publisher: 'publisher.alpha',
          contentHash: 'sha256:alpha',
          metadata: { label: 'alpha', version: 1 },
        },
        {
          key: 'beta',
          publisher: 'publisher.beta',
          contentHash: 'sha256:alpha',
          metadata: { label: 'beta' },
        },
        {
          key: 'gamma',
          publisher: 'publisher.alpha',
          contentHash: 'sha256:gamma',
          metadata: { label: 'gamma' },
        },
        {
          key: 'alphaAgain',
          publisher: 'publisher.alpha',
          contentHash: 'sha256:alpha',
          metadata: { label: 'alpha', version: 2 },
        },
        {
          key: 'invalid',
          publisher: '',
          contentHash: 'sha256:invalid',
          metadata: { label: 'invalid' },
        },
        {
          key: 'badMetadata',
          publisher: 'publisher.metadata',
          contentHash: 'sha256:metadata',
          metadata: { callback: (): number => 1 },
        },
      ],
    });

    assert.equal(first.lifecycleState, 'RUNNING');
    assert.equal(first.hasService(IdentityRegistryToken), true);

    const probe = probeOf(first, workspace);
    const tokens = probe.tokens();
    const alphaToken = requireToken(tokens, 'alpha');

    assert.equal(
      alphaToken,
      requireToken(tokens, 'alphaAgain'),
      'the same publisher and content hash must return the same token',
    );
    assert.notEqual(alphaToken, requireToken(tokens, 'beta'));
    assert.notEqual(alphaToken, requireToken(tokens, 'gamma'));
    assert.match(alphaToken, /^idt_/u);

    const outcomes = probe.outcomes();
    const invalid = outcomes.find(
      (outcome) => outcome.operation === 'issue' && outcome.key === 'invalid',
    );
    const badMetadata = outcomes.find(
      (outcome) => outcome.operation === 'issue' && outcome.key === 'badMetadata',
    );

    assert.equal(invalid?.errorCode, 'IDENTITY_REGISTRY_INPUT_INVALID');
    assert.equal(badMetadata?.errorCode, 'IDENTITY_REGISTRY_INPUT_INVALID');

    const registry = registryOf(first, workspace);
    const alpha = registry.resolve(alphaToken);

    assert.ok(alpha !== null);
    assert.equal(alpha.publisher, 'publisher.alpha');
    assert.equal(alpha.contentHash, 'sha256:alpha');
    assert.deepEqual(alpha.metadata, { label: 'alpha', version: 2 });
    assert.equal(alpha.state, 'active');
    assert.equal(registry.resolve('idt_unknown'), null);

    assert.throws(
      () => registry.issue({
        publisher: 'publisher.runtime',
        contentHash: 'sha256:runtime',
        metadata: { label: 'runtime' },
      }),
      IdentityRegistryFrozenError,
    );
    assert.throws(
      () => registry.retire(alphaToken),
      IdentityRegistryFrozenError,
    );
    assert.throws(
      () => registry.revoke(alphaToken),
      IdentityRegistryFrozenError,
    );

    await first.shutdown();

    const second = await bootIdentityKernel(t, workspace, {});
    const secondRegistry = registryOf(second, workspace);

    assert.deepEqual(secondRegistry.resolve(alphaToken), alpha);
    assert.equal(secondRegistry.resolve('idt_unknown'), null);

    await second.shutdown();
  });

  it('reclaims a retired token and keeps a revoked token permanently revoked across a real restart', async (t) => {
    const workspace = await createWorkspace(t);
    const storagePath = workspace.storagePath;

    provisionIdentityRegistryStorage(storagePath);
    await writeIdentityConfig(workspace);

    const gammaBinding: IdentityBinding = {
      publisher: 'publisher.retire',
      contentHash: 'sha256:retire',
      metadata: { label: 'retire' },
    };
    const deltaBinding: IdentityBinding = {
      publisher: 'publisher.revoke',
      contentHash: 'sha256:revoke',
      metadata: { label: 'revoke' },
    };

    const first = await bootIdentityKernel(t, workspace, {
      issue: [
        { key: 'gamma', ...gammaBinding },
        { key: 'delta', ...deltaBinding },
      ],
      retireKeys: ['gamma'],
      revokeKeys: ['delta'],
    });

    const firstProbe = probeOf(first, workspace);
    const firstTokens = firstProbe.tokens();
    const gammaToken = requireToken(firstTokens, 'gamma');
    const deltaToken = requireToken(firstTokens, 'delta');
    const firstRegistry = registryOf(first, workspace);

    assert.equal(firstRegistry.resolve(gammaToken)?.state, 'retired');
    assert.equal(firstRegistry.resolve(deltaToken)?.state, 'revoked');

    await first.shutdown();

    const second = await bootIdentityKernel(t, workspace, {
      issue: [
        { key: 'gammaReclaimed', ...gammaBinding },
        { key: 'deltaReissued', ...deltaBinding },
      ],
    });

    const secondProbe = probeOf(second, workspace);
    const secondOutcomes = secondProbe.outcomes();
    const reclaimed = secondOutcomes.find(
      (outcome) => outcome.operation === 'issue' && outcome.key === 'gammaReclaimed',
    );
    const reissued = secondOutcomes.find(
      (outcome) => outcome.operation === 'issue' && outcome.key === 'deltaReissued',
    );

    assert.equal(reclaimed?.token, gammaToken);
    assert.equal(reclaimed?.record?.state, 'active');
    assert.equal(reissued?.errorCode, 'IDENTITY_REGISTRY_REVOKED');
    assert.equal(reissued?.token, undefined);

    const secondRegistry = registryOf(second, workspace);

    assert.equal(secondRegistry.resolve(gammaToken)?.state, 'active');
    assert.equal(secondRegistry.resolve(gammaToken)?.token, gammaToken);
    assert.equal(secondRegistry.resolve(deltaToken)?.state, 'revoked');

    await second.shutdown();
  });

  it('refuses boot on corrupt storage and never regenerates the registry', async (t) => {
    const workspace = await createWorkspace(t);
    const storagePath = workspace.storagePath;

    provisionIdentityRegistryStorage(storagePath);
    await writeIdentityConfig(workspace);
    const corrupted = '{"format":"brud.identity-registry","version":1';

    await writeFile(storagePath, corrupted, 'utf8');

    await assert.rejects(
      bootKernel(workspace.configPath, { options: bootOptions(workspace, {}) }),
      (error: unknown) => {
        assert.ok(error instanceof IdentityRegistryCorruptError);
        assert.match(error.message, /integrity validation/u);
        return true;
      },
    );

    assert.equal(await readFile(storagePath, 'utf8'), corrupted);
  });

  it('refuses boot on missing storage and never regenerates the registry', async (t) => {
    const workspace = await createWorkspace(t);
    const storagePath = workspace.storagePath;

    provisionIdentityRegistryStorage(storagePath);
    await writeIdentityConfig(workspace);

    await unlink(storagePath);

    await assert.rejects(
      bootKernel(workspace.configPath, { options: bootOptions(workspace, {}) }),
      (error: unknown) => {
        assert.ok(error instanceof IdentityRegistryMissingError);
        assert.match(error.message, /missing/u);
        return true;
      },
    );

    assert.equal(existsSync(storagePath), false);
  });

  it('refuses direct filesystem mutation while running and releases protection after shutdown', async (t) => {
    const workspace = await createWorkspace(t);
    const storagePath = workspace.storagePath;

    provisionIdentityRegistryStorage(storagePath);
    await writeIdentityConfig(workspace);

    const kernel = await bootIdentityKernel(t, workspace, {
      issue: [{
        key: 'protected',
        publisher: 'publisher.protected',
        contentHash: 'sha256:protected',
        metadata: { label: 'protected' },
      }],
    });

    assert.throws(() => writeFileSync(storagePath, '{}', 'utf8'), isProtectedPathError);
    assert.throws(() => appendFileSync(storagePath, 'tamper', 'utf8'), isProtectedPathError);
    assert.throws(() => unlinkSync(storagePath), isProtectedPathError);
    assert.throws(
      () => renameSync(storagePath, `${storagePath}.moved`),
      isProtectedPathError,
    );
    assert.equal(existsSync(storagePath), true);

    await kernel.shutdown();

    writeFileSync(storagePath, 'operator-managed replacement', 'utf8');
    assert.equal(await readFile(storagePath, 'utf8'), 'operator-managed replacement');
  });
});