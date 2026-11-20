/**
 * The Router's kind ownership and outcome handling, proven with throwaway
 * participants only: who may own a kind, what a route reports for each
 * operation, and how cancellation and malformed results are carried through.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bootKernel } from '../bootstrap/index.js';
import { workspaceContextOptions } from './support/workspaceContext.js';
import {
  bootProbeKernel,
  brud,
  call,
  probeRoot,
  writeComposition,
  writeProbeModule,
} from './support/probeKernel.js';

describe('Router — kind ownership', () => {
  it('routes an operation to the participant that owns its kind, with a kernel-derived caller', async (t) => {
    const probe = await bootProbeKernel(t);
    const routed = await probe.route(brud(call('probe', 'echo', 'word: hello')), undefined, ['acme:cap']);

    assert.equal(routed.status, 'success');
    assert.equal(routed.dispatched, 1);

    const data = routed.operations[0]?.result?.data;

    assert.deepEqual(data?.parameters, { word: 'hello' });
    assert.deepEqual(data?.capabilities, ['acme:cap']);
    assert.equal(data?.origin, 'host');
  });

  it('reports an operation whose kind nobody owns as kind_not_registered and counts it failed', async (t) => {
    const probe = await bootProbeKernel(t);
    const routed = await probe.route(brud(call('nobody', 'echo', 'x: 1')));

    assert.equal(routed.operations[0]?.status, 'kind_not_registered');
    assert.equal(routed.failed, 1);
    assert.equal(routed.status, 'failed');
  });

  it('refuses boot when two participants claim the same kind', async (t) => {
    const root = await probeRoot(t);
    const first = await writeProbeModule(root, 'twin', 'first.mjs');
    const second = await writeProbeModule(root, 'twin', 'second.mjs');
    const configPath = await writeComposition(root, [first, second]);

    await assert.rejects(
      bootKernel(configPath, { options: { ...workspaceContextOptions(root) } }),
      (error: unknown) => {
        assert.match(error instanceof Error ? error.message : String(error), /twin|already|claim|duplicate/iu);
        return true;
      },
    );
  });

  it('serves two participants, each answering only its own kind', async (t) => {
    const probe = await bootProbeKernel(t, ['alpha', 'beta']);
    const routed = await probe.route(brud(
      call('alpha', 'echo', 'n: 1'),
      call('beta', 'echo', 'n: 2'),
    ));

    assert.equal(routed.status, 'success');
    assert.deepEqual(routed.operations.map((operation) => operation.result?.data?.parameters), [{ n: '1' }, { n: '2' }]);
  });
});

describe('Router — operation outcomes', () => {
  it('carries a typed failure through and keeps routing the remaining operations', async (t) => {
    const probe = await bootProbeKernel(t);
    const routed = await probe.route(brud(call('probe', 'fail'), call('probe', 'echo', 'x: 1')));

    assert.equal(routed.status, 'partial');
    assert.equal(routed.failed, 1);
    assert.equal(routed.operations[0]?.status, 'failed');
    assert.equal(routed.operations[1]?.status, 'success');
  });

  it('skips the rest after a failure when stopOnFailure is set', async (t) => {
    const probe = await bootProbeKernel(t);
    const routed = await probe.route(brud(call('probe', 'fail'), call('probe', 'echo', 'x: 1')), { stopOnFailure: true });

    assert.deepEqual(routed.operations.map((operation) => operation.status), ['failed', 'skipped']);
  });

  it('turns a throwing participant into a typed failure without crashing the route', async (t) => {
    const probe = await bootProbeKernel(t);
    const routed = await probe.route(brud(call('probe', 'throw'), call('probe', 'echo', 'x: 1')));

    assert.equal(routed.operations[0]?.status, 'failed');
    assert.match(String(routed.operations[0]?.error), /^ROUTE_DISPATCH_ERROR: /u);
    assert.equal(routed.operations[1]?.status, 'success');
  });

  it('rejects a result of an unexpected shape before aggregating it', async (t) => {
    const probe = await bootProbeKernel(t);
    const routed = await probe.route(brud(call('probe', 'invalid')));
    const outcome = routed.operations[0];

    assert.equal(routed.status, 'failed');
    assert.equal(outcome?.status, 'failed');
    assert.match(String(outcome?.error), /^HANDLER_INVALID_RESULT: /u);
  });

  it('carries an aborted result through unchanged when the caller cancels', async (t) => {
    const probe = await bootProbeKernel(t);
    const controller = new AbortController();
    const pending = probe.route(brud(call('probe', 'sleep', 'ms: 5000')), { signal: controller.signal });

    setTimeout(() => controller.abort(), 100);

    const routed = await pending;

    assert.equal(routed.operations[0]?.status, 'aborted');
    assert.equal(routed.operations[0]?.result?.status, 'aborted');
    assert.equal(routed.failed, 0, 'a cancellation is not a failure');
  });

  it('carries a skipped result through unchanged', async (t) => {
    const probe = await bootProbeKernel(t);
    const routed = await probe.route(brud(call('probe', 'skip')));

    assert.equal(routed.operations[0]?.status, 'skipped');
  });

  it('marks every operation aborted when the signal is already aborted', async (t) => {
    const probe = await bootProbeKernel(t);
    const controller = new AbortController();

    controller.abort();

    const routed = await probe.route(brud(call('probe', 'echo', 'x: 1'), call('probe', 'echo', 'x: 2')), { signal: controller.signal });

    assert.deepEqual(routed.operations.map((operation) => operation.status), ['aborted', 'aborted']);
    assert.equal(routed.dispatched, 0);
  });

  it('passes dryRun to the owner and reports no dispatch', async (t) => {
    const probe = await bootProbeKernel(t);
    const routed = await probe.route(brud(call('probe', 'echo', 'x: 1')), { dryRun: true });

    assert.equal(routed.dispatched, 0);
    assert.equal(routed.operations[0]?.result?.data?.dryRun, true);
  });
});
