import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  DirectoryEntry,
  FileStats,
  IStorageDriver,
  PathEntryStats,
} from '../../../drivers/contracts/index.js';
import { InMemoryStorageDriver } from '../../../drivers/memory/index.js';
import { WorkspaceViolationError } from '../../WorkspaceService/contracts/errors.js';
import type {
  IWorkspaceService,
  WorkspaceLocation,
} from '../../WorkspaceService/contracts/IWorkspaceService.js';
import { WorkspaceService } from '../../WorkspaceService/orchestrator/WorkspaceService.js';
import { createStorageDriverPathPort } from '../../WorkspaceService/ports/StorageDriverPathPort.js';
import { BrudFileSystem } from '../orchestrator/BrudFileSystem.js';

const ROOT = '/workspace';

class CountingDriver implements IStorageDriver {
  public calls = 0;

  private readonly inner = new InMemoryStorageDriver();

  reset(): void {
    this.calls = 0;
  }

  async readFile(absolutePath: string): Promise<Uint8Array> {
    this.calls += 1;

    return this.inner.readFile(absolutePath);
  }

  async readText(absolutePath: string, encoding?: BufferEncoding): Promise<string> {
    this.calls += 1;

    return this.inner.readText(absolutePath, encoding);
  }

  async writeFile(absolutePath: string, data: Uint8Array | string): Promise<void> {
    this.calls += 1;
    await this.inner.writeFile(absolutePath, data);
  }

  async deleteFile(absolutePath: string): Promise<void> {
    this.calls += 1;
    await this.inner.deleteFile(absolutePath);
  }

  async rename(sourcePath: string, targetPath: string): Promise<void> {
    this.calls += 1;
    await this.inner.rename(sourcePath, targetPath);
  }

  async mkdir(
    absoluteDirectoryPath: string,
    options?: { recursive?: boolean },
  ): Promise<void> {
    this.calls += 1;
    await this.inner.mkdir(absoluteDirectoryPath, options);
  }

  async readDir(absoluteDirectoryPath: string): Promise<readonly DirectoryEntry[]> {
    this.calls += 1;

    return this.inner.readDir(absoluteDirectoryPath);
  }

  async stat(absolutePath: string): Promise<FileStats | null> {
    this.calls += 1;

    return this.inner.stat(absolutePath);
  }

  async exists(absolutePath: string): Promise<boolean> {
    this.calls += 1;

    return this.inner.exists(absolutePath);
  }

  async lstat(absolutePath: string): Promise<PathEntryStats | null> {
    this.calls += 1;

    return this.inner.lstat(absolutePath);
  }

  async realpath(absolutePath: string): Promise<string> {
    this.calls += 1;

    return this.inner.realpath(absolutePath);
  }
}

class RecordingWorkspace implements IWorkspaceService {
  public readonly resolvedPaths: string[] = [];

  public readonly absoluteRequests: string[] = [];

  constructor(private readonly inner: WorkspaceService) {}

  get roots(): readonly string[] {
    return this.inner.roots;
  }

  get primaryRoot(): string {
    return this.inner.primaryRoot;
  }

  async resolve(userPath: string): Promise<WorkspaceLocation> {
    this.resolvedPaths.push(`resolve:${userPath}`);

    return this.inner.resolve(userPath);
  }

  async resolveContained(userPath: string): Promise<WorkspaceLocation> {
    this.resolvedPaths.push(userPath);

    return this.inner.resolveContained(userPath);
  }

  async contains(absolutePath: string): Promise<boolean> {
    return this.inner.contains(absolutePath);
  }

  async toKernelPath(userPath: string): Promise<string> {
    return this.inner.toKernelPath(userPath);
  }

  toAbsolutePath(kernelPath: string, rootHint?: string): string {
    this.absoluteRequests.push(kernelPath);

    return this.inner.toAbsolutePath(kernelPath, rootHint);
  }
}

async function createHarness(): Promise<{
  service: BrudFileSystem;
  workspace: RecordingWorkspace;
  driver: CountingDriver;
}> {
  const driver = new CountingDriver();
  const inner = new WorkspaceService({
    roots: [ROOT],
    primaryRoot: ROOT,
    port: createStorageDriverPathPort(driver),
    flavor: 'posix',
  });

  await inner.initialize();

  const workspace = new RecordingWorkspace(inner);
  const service = new BrudFileSystem(workspace, driver, { root: ROOT });

  await service.initialize();
  driver.reset();

  return { service, workspace, driver };
}

function isWorkspaceViolation(error: unknown): boolean {
  return error instanceof WorkspaceViolationError
    && error.code === 'WORKSPACE_PATH_VIOLATION';
}

describe('BrudFileSystem workspace containment', () => {
  it('binds to the workspace authority canonical root', async () => {
    const { service, workspace } = await createHarness();

    assert.equal(service.workspaceRoot, workspace.primaryRoot);
    assert.equal(service.workspaceRoot, ROOT);
  });

  it('resolves every public operation through WorkspaceService.resolveContained', async () => {
    const { service, workspace } = await createHarness();

    workspace.resolvedPaths.length = 0;

    await service.writeAtomic('notes/draft.md', '# draft');
    await service.readFile('notes/draft.md');
    await service.readText('notes/draft.md');
    await service.createFile('notes/other.md', '# other');
    await service.stat('notes/draft.md');
    await service.exists('notes/draft.md');
    await service.readDirectory('notes');
    await service.deleteFile('notes/other.md');

    const stagingPaths = workspace.resolvedPaths.filter((path) => path.startsWith(`${ROOT}/notes/.`));

    assert.equal(stagingPaths.length, 2);

    for (const stagingPath of stagingPaths) {
      assert.match(stagingPath, /^\/.+\/\..+\.\d+\.[0-9a-f-]{36}\.tmp$/u);
    }

    assert.deepEqual(
      workspace.resolvedPaths.filter((path) => !path.startsWith(`${ROOT}/notes/.`)),
      [
        'notes/draft.md',
        'notes/draft.md',
        'notes/draft.md',
        'notes/other.md',
        'notes/draft.md',
        'notes/draft.md',
        'notes',
        'notes/other.md',
      ],
    );
  });

  it('uses WorkspaceService.toAbsolutePath for implicit parent directories', async () => {
    const { service, workspace } = await createHarness();

    workspace.absoluteRequests.length = 0;
    service.onMutation(() => undefined);

    await service.writeAtomic('deep/nested/file.txt', 'payload');

    assert.deepEqual(workspace.absoluteRequests, ['deep/nested']);
  });

  it('rejects traversal before any storage driver call', async () => {
    const { service, driver } = await createHarness();

    driver.reset();

    await assert.rejects(service.readFile('../outside.txt'), isWorkspaceViolation);
    await assert.rejects(service.writeAtomic('../../outside.txt', 'nope'), isWorkspaceViolation);
    await assert.rejects(service.deleteFile('notes/../../outside.txt'), isWorkspaceViolation);
    await assert.rejects(service.exists('notes/\0hidden.txt'), isWorkspaceViolation);

    assert.equal(driver.calls, 0);
  });

  it('rejects an absolute path outside the root before any storage driver call', async () => {
    const { service, driver } = await createHarness();

    driver.reset();

    await assert.rejects(service.readFile('/outside/secret.txt'), (error: unknown) => {
      assert.ok(error instanceof WorkspaceViolationError);
      assert.equal(error.rule, 'OUTSIDE_ROOT');

      return true;
    });
    await assert.rejects(
      service.writeAtomic('/workspace-evil/secret.txt', 'nope'),
      (error: unknown) => {
        assert.ok(error instanceof WorkspaceViolationError);
        assert.equal(error.rule, 'SIBLING_PREFIX');

        return true;
      },
    );

    assert.equal(driver.calls, 0);
  });

  it('forwards absolute paths that are inside the root to the workspace authority', async () => {
    const { service } = await createHarness();

    await service.writeAtomic('notes/draft.md', '# draft');

    assert.equal(await service.readText(`${ROOT}/notes/draft.md`), '# draft');
  });
});
