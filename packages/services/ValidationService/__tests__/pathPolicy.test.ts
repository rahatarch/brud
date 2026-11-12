import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NodeStorageDriver } from '@brud/kernel';
import type { ValidationPolicy } from '../contracts/IValidationService.js';
import type { ValidationDecision } from '../contracts/errors.js';
import { isValidationFailure } from '../contracts/errors.js';
import { ValidationService } from '../orchestrator/ValidationService.js';
import { WorkspaceService } from '../../WorkspaceService/orchestrator/WorkspaceService.js';
import { createStorageDriverPathPort } from '../../WorkspaceService/ports/StorageDriverPathPort.js';

const driver = new NodeStorageDriver();
const port = createStorageDriverPathPort(driver);
const flavor = process.platform === 'win32' ? 'win32' : 'posix';

function policy(): ValidationPolicy {
  return {
    workspaceBoundaryEnabled: true,
    commandValidationEnabled: true,
    toolAllowList: {},
    readConcurrency: 16,
    readMaxBatchFiles: 100,
    readMaxAggregateBytes: 8 * 1024 * 1024,
    schemaVersion: 1,
  };
}

async function createWorkspace(content?: string): Promise<string> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'brud-validation-policy-')));

  await mkdir(join(base, 'secrets'), { recursive: true });
  await mkdir(join(base, 'src'), { recursive: true });
  await writeFile(join(base, 'src', 'main.ts'), 'export {};\n', 'utf8');
  await writeFile(join(base, 'secrets', 'token.txt'), 'TOP-SECRET\n', 'utf8');
  await writeFile(join(base, 'app.log'), 'log\n', 'utf8');
  await writeFile(join(base, 'keep.log'), 'keep\n', 'utf8');
  await mkdir(join(base, '.git'), { recursive: true });
  await writeFile(join(base, '.git', 'config'), '[core]\n', 'utf8');
  await mkdir(join(base, '.brud', 'history'), { recursive: true });
  await writeFile(join(base, '.brud', 'history', 'universal.db'), 'LEDGER', 'utf8');
  await writeFile(join(base, '.brud', 'settings.json'), '{}\n', 'utf8');

  if (content !== undefined) {
    await writeFile(join(base, '.brudignore'), content, 'utf8');
  }

  return base;
}

async function createServices(root: string): Promise<{
  workspace: WorkspaceService;
  validation: ValidationService;
}> {
  const workspace = new WorkspaceService({ roots: [root], port, flavor });

  await workspace.initialize();

  const validation = new ValidationService({
    policy: policy(),
    workspace,
    environment: {
      homeDirectory: process.env.HOME ?? '/home',
      flavor,
    },
    ignoreFileReader: (absolutePath: string) => driver.readFile(absolutePath),
  });

  return { workspace, validation };
}

function failure(decision: ValidationDecision): Extract<ValidationDecision, { readonly ok: false }> {
  assert.equal(isValidationFailure(decision), true, 'expected a failure decision');

  return decision as Extract<ValidationDecision, { readonly ok: false }>;
}

describe('ValidationService — canonical A10 and .brudignore policy', () => {
  it('denies A10 reads and writes through the validation gate', async (context) => {
    const root = await createWorkspace();
    context.after(async () => {
      await rm(root, { recursive: true, force: true });
    });
    const { validation } = await createServices(root);

    for (const target of [
      '.brud/history/universal.db',
      '.brud/history',
      '.git/config',
      '.git',
      '.brud/settings.json',
      '.brudignore',
    ]) {
      for (const access of ['read', 'mutate', 'delete'] as const) {
        const decision = failure(await validation.validatePath(target, access));

        assert.equal(decision.code, 'PROTECTED_PATH_DENIED', `${access} ${target}`);
        assert.equal(decision.rule, 'PATH.PROTECTED_DENY', `${access} ${target}`);
      }
    }
  });

  it('parses .brudignore read-only and denies user-ignored paths', async (context) => {
    const root = await createWorkspace('secrets/\n*.log\n!keep.log\n');
    context.after(async () => {
      await rm(root, { recursive: true, force: true });
    });
    const { validation } = await createServices(root);

    const ignoredDirectory = failure(await validation.validatePath('secrets/token.txt', 'read'));
    assert.equal(ignoredDirectory.code, 'PATH_IGNORED_BY_USER');
    assert.equal(ignoredDirectory.rule, 'PATH.USER_IGNORED');

    const ignoredFile = failure(await validation.validatePath('app.log', 'mutate'));
    assert.equal(ignoredFile.code, 'PATH_IGNORED_BY_USER');

    assert.deepEqual(await validation.validatePath('keep.log', 'read'), { ok: true });
    assert.deepEqual(await validation.validatePath('src/main.ts', 'read'), { ok: true });
  });

  it('keeps WorkspaceService geometry-only after consolidation', async (context) => {
    const root = await createWorkspace('secrets/\n');
    context.after(async () => {
      await rm(root, { recursive: true, force: true });
    });
    const { workspace } = await createServices(root);

    assert.equal((await workspace.resolveContained('.git/config')).relativePath, '.git/config');
    assert.equal((await workspace.resolveContained('.brud/settings.json')).relativePath, '.brud/settings.json');
    assert.equal((await workspace.resolveContained('secrets/token.txt')).relativePath, 'secrets/token.txt');
    assert.equal('pathPolicy' in workspace, false);
  });

  it('never creates .brudignore when the user has not provided one', async (context) => {
    const root = await createWorkspace();
    context.after(async () => {
      await rm(root, { recursive: true, force: true });
    });
    const { validation } = await createServices(root);

    await assert.rejects(
      () => readFile(join(root, '.brudignore'), 'utf8'),
      (error: unknown) => (error as { readonly code?: unknown }).code === 'ENOENT',
    );
    assert.deepEqual(await validation.validatePath('src/main.ts', 'read'), { ok: true });
  });
});