import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { bootKernel } from '../bootstrap/index.js';
import { createStandardKernel } from './support/standardKernel.js';
import type { ServiceContext } from '../contracts/lifecycle.js';
import { AllowlistViolationError } from '../contracts/policy.js';
import type { BrudKernel } from '../engine/BrudKernel.js';
import { FileMutationJournalToken } from '../../../services/BrudFileSystem/descriptor/journalTokens.js';
import { FileSystemToken } from '../../../services/BrudFileSystem/descriptor/tokens.js';
import type { BrudFileSystem } from '../../../services/BrudFileSystem/orchestrator/BrudFileSystem.js';
import {
  HistoryToken,
  UniversalHistoryToken,
} from '../../../services/UniversalHistory/descriptor/tokens.js';
import { workspaceContextOptions } from './support/workspaceContext.js';

async function workspace(t: TestContext): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'brud-side-channel-')));

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  return root;
}

function caller(id: string, root: string): ServiceContext {
  return { callerId: id, tier: 'core', options: workspaceContextOptions(root) };
}

async function bootStandard(root: string): Promise<BrudKernel> {
  const kernel = createStandardKernel();

  await kernel.boot({ options: workspaceContextOptions(root) });

  return kernel;
}

describe('filesystem journal is exposed through the exposed-API path', () => {
  it('registers the journal API and history resolves the same journal through the broker', async (t) => {
    const root = await workspace(t);
    const kernel = await bootStandard(root);

    try {
      assert.equal(kernel.hasService(FileMutationJournalToken), true);

      const historyView = kernel.requestAccess(
        caller(UniversalHistoryToken.id, root),
        FileMutationJournalToken,
      );
      const fileSystem = kernel.requestAccess(
        caller('brud.verification.filesystem', root),
        FileSystemToken,
      ) as BrudFileSystem;

      assert.equal(historyView.journal, fileSystem.mutationJournal);
      assert.equal(historyView.journal.enabled, true);
      assert.equal(typeof historyView.driver.readFile, 'function');
    } finally {
      await kernel.shutdown();
    }
  });

  it('records a real filesystem mutation in real on-disk history', async (t) => {
    const root = await workspace(t);
    const kernel = await bootStandard(root);

    try {
      const fileSystem = kernel.requestAccess(
        caller('brud.verification.filesystem', root),
        FileSystemToken,
      );
      const history = kernel.requestAccess(
        caller(UniversalHistoryToken.id, root),
        HistoryToken,
      );

      await fileSystem.writeAtomic('src/journal-handoff.txt', 'through the exposed API\n');

      const entries = await history.getHistory({ targetPath: 'src/journal-handoff.txt' });
      const committed = entries.filter((entry) => entry.sessionId !== undefined);

      assert.equal(committed.length > 0, true);
      assert.equal(committed[0]?.targetPath, 'src/journal-handoff.txt');
      assert.equal(committed[0]?.operationKind, 'write');

      const historyDirectory = await readFile(
        join(root, '.brud', 'history', 'universal.db'),
      ).catch(() => undefined);

      assert.notEqual(historyDirectory, undefined, 'history persisted to real on-disk storage');
    } finally {
      await kernel.shutdown();
    }
  });

  it('refuses a participant the filesystem grant does not permit', async (t) => {
    const root = await workspace(t);
    const kernel = await bootStandard(root);

    try {
      assert.throws(
        () => kernel.requestAccess(
          caller('brud.verification.unpermitted', root),
          FileMutationJournalToken,
        ),
        (error: unknown) => {
          assert.ok(error instanceof AllowlistViolationError);
          assert.equal(error.callerId, 'brud.verification.unpermitted');
          assert.equal(error.targetServiceId, FileMutationJournalToken.id);

          return true;
        },
      );

      // The permitted history caller is granted on the same kernel, so the
      // refusal above is the giver's policy, not a closed gate.
      assert.ok(
        kernel.requestAccess(
          caller(UniversalHistoryToken.id, root),
          FileMutationJournalToken,
        ),
      );
    } finally {
      await kernel.shutdown();
    }
  });
});

function gateFixtureModule(): string {
  return `
import { writeFileSync } from 'node:fs';

let broker;
let reportPath;

const filesystemToken = { id: 'brud.core.filesystem', description: 'filesystem', _brand: undefined };
const journalToken = { id: 'brud.core.filesystem.mutationJournal', description: 'journal', _brand: undefined };

export function createService(context) {
  reportPath = context.options['gate.report.path'];

  return {
    token: { id: 'test.gate.participant', description: 'gate participant', _brand: undefined },
    tier: 'core',
    dependencies: [],
    factory: (_context, accessBroker) => {
      broker = accessBroker;

      return { initialize() {}, dispose() {} };
    },
  };
}

export async function pinBootPolicies() {
  const caller = { callerId: 'test.gate.participant', tier: 'core', options: {} };
  const report = {};

  try {
    broker.requestAccess(caller, filesystemToken);
    report.filesystem = 'granted';
  } catch (error) {
    report.filesystem = error && error.name ? error.name : String(error);
  }

  try {
    broker.requestAccess(caller, journalToken);
    report.journal = 'granted';
  } catch (error) {
    report.journal = error && error.name ? error.name : String(error);
  }

  writeFileSync(reportPath, JSON.stringify(report), 'utf8');
}
`;
}

describe('lifecycle gate is a general, permission-gated boot-window rule (R-13 first branch)', () => {
  it('lets an unknown non-official participant resolve a permitted service during the window and refuses an unpermitted one', async (t) => {
    const root = await workspace(t);
    const fixturePath = join(root, 'gateFixture.mjs');
    const reportPath = join(root, 'gate-report.json');
    const configPath = join(root, 'brud.config.json');
    const standardConfigPath = process.env['BRUD_STANDARD_CONFIG'];

    assert.ok(standardConfigPath, 'the kernel test runner supplies the standard composition');

    const standard = JSON.parse(
      await readFile(standardConfigPath, 'utf8'),
    ) as { readonly services: readonly unknown[]; readonly plugins: readonly unknown[] };

    await writeFile(fixturePath, gateFixtureModule(), 'utf8');
    await writeFile(
      configPath,
      JSON.stringify({
        services: [...standard.services, { path: fixturePath, official: false }],
        plugins: [],
      }, null, 2),
      'utf8',
    );

    const kernel = await bootKernel(configPath, {
      options: {
        ...workspaceContextOptions(root),
        'gate.report.path': reportPath,
        history: { inMemory: true },
      },
    });

    try {
      const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
        readonly filesystem: string;
        readonly journal: string;
      };

      assert.equal(report.filesystem, 'granted');
      assert.equal(report.journal, 'AllowlistViolationError');
    } finally {
      await kernel.shutdown();
    }
  });
});

describe('kernel carries no mutation journal contract', () => {
  it('exports no MutationJournalPort and no filesystem journal API', async () => {
    const kernelModule = await import('../../index.js');

    assert.equal('MutationJournalPort' in kernelModule, false);
    assert.equal('FileMutationJournalToken' in kernelModule, false);
    assert.equal('IFileMutationJournalApi' in kernelModule, false);
  });
});