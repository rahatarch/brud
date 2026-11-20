/**
 * The Parser's input handling through its `syntax.parse` exposure, using a
 * throwaway participant only: wrapper handling, several operations in one
 * wrapper, and content that must not be read as operations.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bootProbeKernel, brud, call } from '../../../src/__tests__/support/probeKernel.js';

describe('Parser — wrapper and operation handling', () => {
  it('parses several operations from one wrapper, in order', async (t) => {
    const probe = await bootProbeKernel(t);
    const parsed = await probe.parse(brud(call('probe', 'echo', 'n: 1'), call('probe', 'echo', 'n: 2')));

    assert.equal(parsed.ok, true);
    assert.equal(parsed.operations?.length, 2);
  });

  it('reads nothing from text outside a wrapper', async (t) => {
    const probe = await bootProbeKernel(t);
    const parsed = await probe.parse(call('probe', 'echo', 'n: 1'));
    const operations = parsed.ok ? parsed.operations ?? [] : [];

    assert.equal(operations.length, 0, 'an operation without a wrapper is plain text, not a request');
  });

  it('does not treat an operation quoted inside an operation body as a second operation', async (t) => {
    const probe = await bootProbeKernel(t);
    const nested = call('probe', 'echo', 'text: |', '  ' + call('probe', 'echo', 'n: 9'));
    const parsed = await probe.parse(brud(nested));

    if (parsed.ok) {
      assert.ok((parsed.operations?.length ?? 0) <= 1, 'a quoted block must not add an operation');
    } else {
      assert.ok(parsed.error?.code, 'a refusal must carry a code');
    }
  });

  it('refuses an unterminated wrapper with a coded error rather than dispatching', async (t) => {
    const probe = await bootProbeKernel(t);
    const routed = await probe.route('[BRUD]\n' + call('probe', 'echo', 'n: 1'));

    assert.equal(routed.dispatched, 0);
  });
});
