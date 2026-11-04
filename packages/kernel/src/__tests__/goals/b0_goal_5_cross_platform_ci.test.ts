import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CI_WORKFLOW, GOALS_DIR } from './_support.js';

const FIXTURE = join(GOALS_DIR, 'fixtures/test-matrix.yml');

describe('B0 Goal 5 — cross-platform CI coverage is recorded (non-blocking)', () => {
  it('records the runner matrix and whether the kernel suite runs there', async (t) => {
    const workflow = await readFile(CI_WORKFLOW, 'utf8');

    assert.match(workflow, /^name:/mu, 'a CI workflow must exist');
    assert.match(workflow, /jobs:/u, 'the workflow must define jobs');
    assert.match(workflow, /runs-on:/u, 'the workflow must declare runners');

    const runners = [...workflow.matchAll(/runs-on:\s*([^\n]+)/gu)].map((match) =>
      (match[1] ?? '').trim(),
    );
    assert.ok(runners.length > 0, 'at least one runner must be declared');

    const matrix = /matrix\s*:/u.test(workflow);
    const macOS = /\bmacos/iu.test(workflow);
    const windows = /\bwindows/iu.test(workflow);
    const kernelSuite = /test:kernel|@brud\/kernel|workspace\s+@brud\/kernel/u.test(workflow);

    t.diagnostic(`runners=${JSON.stringify(runners)}`);
    t.diagnostic(`matrix=${String(matrix)} macOS=${String(macOS)} Windows=${String(windows)}`);
    t.diagnostic(`kernelSuite=${String(kernelSuite)}`);

    if (macOS || windows) {
      assert.equal(macOS, true, 'macOS must be in the runner matrix');
      assert.equal(windows, true, 'Windows must be in the runner matrix');
      assert.equal(
        kernelSuite,
        true,
        'the kernel test suite must run on the cross-platform matrix',
      );
      return;
    }

    const fixture = await readFile(FIXTURE, 'utf8');
    assert.equal(
      fixture,
      workflow,
      'the recorded fixture must match .github/workflows/test-matrix.yml verbatim',
    );
    assert.equal(
      kernelSuite,
      false,
      'the recorded state must report that CI does not run the kernel suite',
    );

    t.diagnostic(
      'NON-BLOCKING: cross-platform CI is absent. The workflow runs only ubuntu-latest and does not run the kernel test suite; cross-platform symlink E2E is deferred.',
    );
  });
});