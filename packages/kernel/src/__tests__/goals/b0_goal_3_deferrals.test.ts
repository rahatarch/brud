import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readRepoFile } from './_support.js';
import { NodeStorageDriver } from '../../../drivers/node/index.js';
import { WorkspaceService } from '../../../../services/WorkspaceService/orchestrator/WorkspaceService.js';
import { createStorageDriverPathPort } from '../../../../services/WorkspaceService/ports/StorageDriverPathPort.js';

const WINDOWS_ROOT = 'C:\\Users\\Dev\\Workspace';

const WINDOWS_CASES = [
  'canonicalizes drive case and trailing separators',
  'accepts absolute paths inside the root across separators and case',
  'rejects case-sensitive siblings and other roots',
  'rejects drive-relative, UNC, and device paths',
  'applies reserved device, ADS, and trailing dot/space rules',
  'returns host-native absolute paths for kernel descriptors',
  'rejects a volume root unless explicitly allowed',
  'rejects UNC and device roots outright',
] as const;

const WORKSPACE_SERVICE_TEST =
  'packages/services/WorkspaceService/orchestrator/WorkspaceService.test.ts';

async function assertViolation(promise: Promise<unknown>, rule: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.equal((error as { rule?: string }).rule, rule);
    return true;
  });
}

async function createWindowsService(): Promise<WorkspaceService> {
  const service = new WorkspaceService({
    roots: [WINDOWS_ROOT],
    port: createStorageDriverPathPort(new NodeStorageDriver()),
    flavor: 'win32',
  });
  await service.initialize();

  return service;
}

describe('B0 Goal 3 — deferrals are documented and technically justified', () => {
  it('records both daemon test deferrals as Phase 10 scope', async () => {
    const plan = await readRepoFile('docs/architecture/ROLLOUT_PLAN_CORE_TO_MICROKERNEL.md');

    for (const path of [
      'packages/daemon/src/__tests__/dispatch.test.ts',
      'packages/daemon/src/__tests__/lifecycle.test.ts',
    ]) {
      await readRepoFile(path);
    }

    const phase10 = plan.slice(
      plan.indexOf('#### Phase 10'),
      plan.indexOf('#### Phase 11'),
    );
    assert.match(phase10, /daemon/iu);
    assert.match(phase10, /createStandardKernel/u);
    assert.match(phase10, /daemon.*tests pass/isu);
  });

  it('keeps all eight Windows-semantics cases as executable tests in WorkspaceService.test.ts', async () => {
    const source = await readRepoFile(WORKSPACE_SERVICE_TEST);

    assert.ok(
      !/Deferred to Phase 6\.B\/10/u.test(source),
      'the false Windows-semantics deferral comment must be removed',
    );
    assert.match(source, /describe\('WorkspaceService — Windows semantics'/u);

    const lines = source.split('\n');

    for (const name of WINDOWS_CASES) {
      assert.ok(
        lines.some((line) => line.includes(`it('${name}'`)),
        `the case "${name}" must be an executable test in ${WORKSPACE_SERVICE_TEST}`,
      );
    }
  });

  it('passes all eight Windows-semantics cases with a real path port on every host', async () => {
    const results: string[] = [];

    const service = await createWindowsService();

    results.push('canonicalizes drive case and trailing separators');
    const canonical = new WorkspaceService({
      roots: ['c:\\Users\\Dev\\Workspace\\'],
      port: createStorageDriverPathPort(new NodeStorageDriver()),
      flavor: 'win32',
    });
    await canonical.initialize();
    assert.deepEqual(canonical.roots, [WINDOWS_ROOT]);

    results.push('accepts absolute paths inside the root across separators and case');
    assert.equal((await service.resolve('notes\\a.md')).relativePath, 'notes/a.md');
    assert.equal(
      (await service.resolve('c:/users/dev/workspace/notes/a.md')).relativePath,
      'notes/a.md',
    );
    assert.equal(
      (await service.resolve('C:\\Users\\Dev\\Workspace\\notes\\a.md')).relativePath,
      'notes/a.md',
    );

    results.push('rejects case-sensitive siblings and other roots');
    await assertViolation(
      service.resolve('c:\\users\\dev\\workspace-evil\\a.md'),
      'SIBLING_PREFIX',
    );
    await assertViolation(service.resolve('D:\\Users\\Dev\\Workspace\\a.md'), 'OUTSIDE_ROOT');

    results.push('rejects drive-relative, UNC, and device paths');
    await assertViolation(service.resolve('C:notes\\a.md'), 'TRAVERSAL');
    await assertViolation(service.resolve('\\\\server\\share\\a.md'), 'TRAVERSAL');
    await assertViolation(service.resolve('\\\\?\\C:\\Users\\Dev\\Workspace\\a.md'), 'TRAVERSAL');

    results.push('applies reserved device, ADS, and trailing dot/space rules');
    await assertViolation(service.resolve('nul'), 'RESERVED_DEVICE');
    await assertViolation(service.resolve('CON.txt'), 'RESERVED_DEVICE');
    await assertViolation(service.resolve('file.txt:stream'), 'ALTERNATE_DATA_STREAM');
    await assertViolation(service.resolve('a.'), 'TRAVERSAL');
    await assertViolation(service.resolve('.. \\secret.txt'), 'TRAVERSAL');

    results.push('returns host-native absolute paths for kernel descriptors');
    assert.equal(
      service.toAbsolutePath('notes/a.md'),
      'C:\\Users\\Dev\\Workspace\\notes\\a.md',
    );
    assert.equal(service.toAbsolutePath(''), WINDOWS_ROOT);

    results.push('rejects a volume root unless explicitly allowed');
    assert.throws(
      () =>
        new WorkspaceService({
          roots: ['C:\\'],
          port: createStorageDriverPathPort(new NodeStorageDriver()),
          flavor: 'win32',
        }),
      (error: unknown) => (error as { rule?: string }).rule === 'FILESYSTEM_ROOT',
    );

    results.push('rejects UNC and device roots outright');
    assert.throws(
      () =>
        new WorkspaceService({
          roots: ['\\\\server\\share'],
          port: createStorageDriverPathPort(new NodeStorageDriver()),
          flavor: 'win32',
        }),
      (error: unknown) => error instanceof Error,
    );

    assert.equal(results.length, WINDOWS_CASES.length);
  });
});