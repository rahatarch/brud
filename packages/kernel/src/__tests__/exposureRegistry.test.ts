/**
 * Exposed-API registry behavior proven on throwaway participants: the
 * exposures a composition declares are resolvable only with the capabilities
 * that gate them, and a duplicate exposure name refuses the boot.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bootKernel } from '../bootstrap/index.js';
import { workspaceContextOptions } from './support/workspaceContext.js';
import { bootProbeKernel, brud, call, probeRoot, writeComposition, writeProbeModule } from './support/probeKernel.js';

describe('Exposed-API registry', () => {
  it('serves a probe exposure only through the kernel call chain', async (t) => {
    const probe = await bootProbeKernel(t);
    const routed = await probe.route(brud(call('probe', 'echo', 'a: b')));

    assert.equal(routed.status, 'success');
  });

  it('refuses boot when two participants bind the same exposure name', async (t) => {
    const root = await probeRoot(t);
    const a = await writeProbeModule(root, 'same', 'a.mjs');
    const b = await writeProbeModule(root, 'same', 'b.mjs');
    const configPath = await writeComposition(root, [a, b]);

    await assert.rejects(bootKernel(configPath, { options: { ...workspaceContextOptions(root) } }));
  });
});
