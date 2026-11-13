import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { bootKernel } from '../bootstrap/index.js';
import type { BrudKernel } from '../engine/BrudKernel.js';
import { NodeStorageDriver } from '../../drivers/index.js';
import { workspaceContextOptions } from './support/workspaceContext.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const DAEMON_CONFIG_PATH = join(REPO_ROOT, 'packages', 'daemon', 'brud.config.json');

interface BagReport {
  readonly options: readonly string[];
  readonly shared: readonly string[];
  readonly storageDriverPresent: boolean;
  readonly storageDriverIsHost: boolean;
  readonly mutationJournalPresent: boolean;
}

function observerModule(id: string, reportKey: string): string {
  return `
import { writeFileSync } from 'node:fs';

export function createService(context) {
  const report = {
    options: Object.keys(context.options).sort(),
    shared: Object.keys(context.shared).sort(),
    storageDriverPresent: 'storageDriver' in context.options,
    storageDriverIsHost: context.options['storageDriver'] === globalThis.__bc3HostDriver,
    mutationJournalPresent: 'mutationJournal' in context.options,
  };

  writeFileSync(context.options['${reportKey}'], JSON.stringify(report), 'utf8');

  return {
    token: { id: '${id}', description: 'shared-bag boundary observer', _brand: undefined },
    tier: 'kernel',
    dependencies: [],
    factory: () => ({}),
  };
}
`;
}

async function workspace(t: TestContext): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'brud-bc3-')));

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  return root;
}

async function bootWithObservers(
  t: TestContext,
  services: readonly unknown[],
  extraOptions: Record<string, unknown>,
): Promise<{ kernel: BrudKernel; first: BagReport; last: BagReport }> {
  const root = await workspace(t);
  const firstModule = join(root, 'bc3-first.mjs');
  const lastModule = join(root, 'bc3-last.mjs');
  const firstReport = join(root, 'bc3-first.json');
  const lastReport = join(root, 'bc3-last.json');
  const configPath = join(root, 'brud.config.json');

  await writeFile(firstModule, observerModule('test.bc3.first', 'bc3.first.path'), 'utf8');
  await writeFile(lastModule, observerModule('test.bc3.last', 'bc3.last.path'), 'utf8');
  await writeFile(
    configPath,
    JSON.stringify({
      services: [
        { path: firstModule },
        ...services,
        { path: lastModule },
      ],
      plugins: [],
    }, null, 2),
    'utf8',
  );

  const kernel = await bootKernel(configPath, {
    options: {
      ...workspaceContextOptions(root),
      'bc3.first.path': firstReport,
      'bc3.last.path': lastReport,
      ...extraOptions,
    },
  });

  return {
    kernel,
    first: JSON.parse(await readFile(firstReport, 'utf8')) as BagReport,
    last: JSON.parse(await readFile(lastReport, 'utf8')) as BagReport,
  };
}

describe('BC-3: no shared context key used across two owners', () => {
  it('the real standard composition forwards no storageDriver or mutationJournal key and no cross-owner shared slot', async (t) => {
    const standardConfigPath = process.env['BRUD_STANDARD_CONFIG'];

    assert.ok(standardConfigPath, 'the kernel test runner supplies the standard composition');

    const standard = JSON.parse(
      await readFile(standardConfigPath, 'utf8'),
    ) as { readonly services: readonly unknown[] };

    const { kernel, first, last } = await bootWithObservers(
      t,
      standard.services,
      { history: { inMemory: true } },
    );

    try {
      assert.equal(kernel.lifecycleState, 'RUNNING');
      assert.equal(first.storageDriverPresent, false);
      assert.equal(last.storageDriverPresent, false);
      assert.equal(last.mutationJournalPresent, false);
      assert.equal(last.shared.includes('storageDriver'), false);
      assert.equal(last.shared.includes('mutationJournal'), false);
    } finally {
      await kernel.shutdown();
    }
  });

  it('the real daemon composition keeps the host storageDriver and adds no journal key', async (t) => {
    const daemon = JSON.parse(
      await readFile(DAEMON_CONFIG_PATH, 'utf8'),
    ) as { readonly services: readonly unknown[] };
    const hostDriver = new NodeStorageDriver();

    (globalThis as { __bc3HostDriver?: unknown }).__bc3HostDriver = hostDriver;

    const { kernel, first, last } = await bootWithObservers(
      t,
      daemon.services,
      { storageDriver: hostDriver, history: { inMemory: true } },
    );

    try {
      assert.equal(kernel.lifecycleState, 'RUNNING');
      assert.equal(first.storageDriverPresent, true);
      assert.equal(first.storageDriverIsHost, true);
      assert.equal(last.storageDriverPresent, true);
      assert.equal(last.storageDriverIsHost, true);
      assert.equal(last.mutationJournalPresent, false);
      assert.equal(last.shared.includes('storageDriver'), false);
      assert.equal(last.shared.includes('mutationJournal'), false);
    } finally {
      delete (globalThis as { __bc3HostDriver?: unknown }).__bc3HostDriver;
      await kernel.shutdown();
    }
  });

  it('the filesystem and history modules exchange no boot-bag or shared-bag key', async () => {
    const filesystemModule = await readFile(
      join(REPO_ROOT, 'packages', 'services', 'BrudFileSystem', 'serviceModule.ts'),
      'utf8',
    );
    const historyModule = await readFile(
      join(REPO_ROOT, 'packages', 'services', 'UniversalHistory', 'serviceModule.ts'),
      'utf8',
    );

    // The filesystem still reads a host-supplied driver, but never publishes
    // one back into the bag and never publishes a journal.
    assert.doesNotMatch(filesystemModule, /options\[['"](?:storageDriver|mutationJournal)['"]\]\s*=/u);
    assert.doesNotMatch(filesystemModule, /context\.shared\[['"]brud\.core\.history/u);

    // History resolves both through the filesystem's exposed API.
    assert.doesNotMatch(historyModule, /options\[['"](?:storageDriver|mutationJournal)['"]\]/u);
    assert.doesNotMatch(historyModule, /context\.shared\[['"]brud\.core\.filesystem/u);

    assert.match(historyModule, /FileMutationJournalToken/u);
    assert.match(filesystemModule, /FileMutationJournalToken/u);
  });

  it('no production module reads a shared-bag key outside its own namespace, except the two documented boot-instance slots', async () => {
    const files = [
      ...await moduleFiles(join(REPO_ROOT, 'packages', 'kernel', 'services')),
      ...await moduleFiles(join(REPO_ROOT, 'packages', 'services')),
    ];
    const crossOwner = new Set<string>();
    const handoffKeys = new Set<string>();
    const violations: string[] = [];

    // Pre-existing boot-construction coordination: the workspace and
    // validation factories publish their instances before the filesystem
    // factory runs, and the filesystem consumes them during `initialize`,
    // before the broker gate opens. No Step 2 ruling covers this boot-time
    // handoff; it is recorded as an unruled finding in the artifact. Any
    // additional cross-owner key fails this check.
    const BOOT_INSTANCE_SLOTS = new Set([
      'brud.core.workspace.instance',
      'brud.core.validation.instance',
    ]);

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      const namespace = namespaceFor(file);
      const keyPattern = /context\.shared\[\s*(['"])([^'"]+)\1\s*\]/gu;
      let match: RegExpExecArray | null;

      while ((match = keyPattern.exec(source)) !== null) {
        const key = match[2] as string;

        if (key === 'storageDriver' || key === 'mutationJournal') {
          handoffKeys.add(key);
        }

        if (!key.startsWith(namespace) && !BOOT_INSTANCE_SLOTS.has(key)) {
          crossOwner.add(key);
          violations.push(`${relative(REPO_ROOT, file)} reads ${key} outside ${namespace}`);
        }
      }

      const writePattern = /context\.shared\[\s*(['"])([^'"]+)\1\s*\]\s*=/gu;

      while ((match = writePattern.exec(source)) !== null) {
        const key = match[2] as string;

        if (!key.startsWith(namespace)) {
          violations.push(`${relative(REPO_ROOT, file)} writes ${key} outside ${namespace}`);
        }
      }
    }

    assert.deepEqual([...handoffKeys], []);
    assert.deepEqual(violations, []);
    assert.deepEqual([...crossOwner], []);
  });
});

async function moduleFiles(root: string): Promise<string[]> {
  const found: string[] = [];

  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__tests__') {
      continue;
    }

    const full = join(root, entry.name);

    if (entry.isDirectory()) {
      found.push(...await moduleFiles(full));
    } else if (entry.isFile() && entry.name === 'serviceModule.ts') {
      found.push(full);
    }
  }

  return found;
}

function namespaceFor(file: string): string {
  const parts = relative(REPO_ROOT, file).split(sep);

  if (parts[1] === 'kernel' && parts[2] === 'services') {
    return `brud.core.${lowerFirst(parts[3] as string)}`;
  }

  const directory = parts[2] as string;

  if (directory === 'BrudFileSystem') {
    return 'brud.core.filesystem';
  }

  if (directory === 'UniversalHistory') {
    return 'brud.core.history';
  }

  return `brud.core.${lowerFirst(directory.replace(/Service$/u, ''))}`;
}

function lowerFirst(value: string): string {
  return value.length === 0 ? value : value[0]!.toLowerCase() + value.slice(1);
}