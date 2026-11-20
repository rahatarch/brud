/**
 * Production mirror of the daemon as a neutral kernel host: a real daemon, a
 * real authenticated client, a real kernel booted from an operator-owned
 * composition, and a throwaway participant that owns the `probe` kind.
 */
import { strict as assert } from 'node:assert';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import * as Protocol from '@brud/protocol';
import type {
  KernelBootResult,
  KernelDisposeResult,
  KernelKindsResult,
  KernelListResult,
  KernelRequirementsResult,
  KernelStatusResult,
} from '@brud/protocol';
import { connectToDaemon } from '../client/connectToDaemon.js';
import type { DaemonClient } from '../client/DaemonClient.js';
import { DaemonRpcError } from '../client/errors.js';
import { createDaemon } from '../server/createDaemon.js';
import type { RunningDaemon } from '../server/createDaemon.js';
import { createProbeHome, probeCall } from './support/probeHome.js';
import type { ProbeHome } from './support/probeHome.js';

interface RouteResult {
  readonly status: string;
  readonly operations: readonly { readonly status: string; readonly result?: { readonly status: string; readonly data?: Record<string, unknown> } }[];
}

describe('daemon — neutral kernel host', () => {
  let probe: ProbeHome;
  let daemon: RunningDaemon;
  let ui: DaemonClient;
  let ai: DaemonClient;

  before(async () => {
    probe = await createProbeHome();
    daemon = await createDaemon({ home: probe.home, operator: probe.operator, expectedPeerPid: process.pid });
    ui = await connectToDaemon({ home: probe.home, tier: 'ui', spawnIfMissing: false });
    ai = await connectToDaemon({ home: probe.home, tier: 'ai', spawnIfMissing: false });
  });

  after(async () => {
    await ui?.close();
    await ai?.close();
    await daemon?.shutdown();
    await probe?.cleanup();
  });

  it('handshakes without any domain concept and lists its neutral methods', () => {
    const handshake = ui.handshake;

    assert.ok(handshake !== undefined);
    assert.equal(handshake.tier, 'ui');
    assert.equal('workspaceRoot' in handshake, false);
    assert.ok(handshake.capabilities.methods.includes(Protocol.KERNEL_ROUTE));
    assert.equal(handshake.capabilities.methods.some((method) => /^(tools|actions|workspace)\./u.test(method)), false);
  });

  it('reports the composition requirements declared by participants', async () => {
    const result = await ui.request<KernelRequirementsResult>(Protocol.KERNEL_REQUIREMENTS, {});
    const label = result.fields.find((field) => field.name === 'probe.label');

    assert.ok(label !== undefined, 'the probe declared its field');
    assert.equal(label.required, true);
    assert.equal(label.clientSettable, true);
  });

  it('reports participants the kernel left out for missing fields (the kernel decides, not the daemon)', async () => {
    const boot = await ui.request<KernelBootResult>(Protocol.KERNEL_BOOT, { options: {} });

    assert.deepEqual(boot.pruned.flatMap((entry) => entry.missingFields), ['probe.label']);
    assert.deepEqual(boot.pruned.flatMap((entry) => entry.participants), ['acme.probe']);

    const kinds = await ui.request<KernelKindsResult>(Protocol.KERNEL_KINDS, { instanceId: boot.instance.instanceId });
    assert.deepEqual(kinds.kinds, [], 'the pruned probe owns no kind');
    await ui.request(Protocol.KERNEL_DISPOSE, { instanceId: boot.instance.instanceId });
  });

  it('refuses a startup field the operator did not allow clients to set', async () => {
    await assert.rejects(
      ui.request(Protocol.KERNEL_BOOT, { options: { 'probe.label': 'x', 'identity.registry.path': '/tmp/evil.json' } }),
      (error: unknown) => error instanceof DaemonRpcError && /identity\.registry\.path/u.test(error.message),
    );
  });

  it('boots a kernel, lists kinds, and routes Brud syntax inside a host session', async () => {
    const boot = await ui.request<KernelBootResult>(Protocol.KERNEL_BOOT, { options: { 'probe.label': 'alpha' } });
    const instanceId = boot.instance.instanceId;

    assert.equal(boot.instance.state, 'running');
    assert.equal(boot.reused, false);
    assert.deepEqual(boot.pruned, []);

    const kinds = await ui.request<KernelKindsResult>(Protocol.KERNEL_KINDS, { instanceId });

    assert.deepEqual(kinds.kinds.map((entry) => entry.kind), ['probe']);
    assert.equal(kinds.kinds[0]?.description, 'Daemon test probe');

    const routed = await ui.request<RouteResult>(Protocol.KERNEL_ROUTE, { instanceId, text: probeCall('echo', 'word: hello') });
    const data = routed.operations[0]?.result?.data;

    assert.equal(routed.status, 'success');
    assert.equal(data?.label, 'alpha');
    // Capabilities come from the operator's mapping for the `ui` principal.
    assert.deepEqual(data?.capabilities, ['probe:ui']);
    assert.equal(data?.origin, 'host');

    const failed = await ui.request<RouteResult>(Protocol.KERNEL_ROUTE, { instanceId, text: probeCall('fail') });
    assert.equal(failed.operations[0]?.result?.status, 'failed');
  });

  it('keeps instances per connection: another client cannot see or use them', async () => {
    const boot = await ui.request<KernelBootResult>(Protocol.KERNEL_BOOT, { options: { 'probe.label': 'private' } });
    const instanceId = boot.instance.instanceId;
    const aiList = await ai.request<KernelListResult>(Protocol.KERNEL_LIST, {});

    assert.equal(aiList.instances.some((entry) => entry.instanceId === instanceId), false);

    const aiStatus = await ai.request<KernelStatusResult>(Protocol.KERNEL_STATUS, { instanceId });
    assert.equal(aiStatus.instance, null);

    await assert.rejects(
      ai.request(Protocol.KERNEL_ROUTE, { instanceId, text: probeCall('echo') }),
      (error: unknown) => error instanceof DaemonRpcError,
    );

    // Attaching explicitly by id is how a second client shares a kernel.
    await ai.request(Protocol.KERNEL_ATTACH, { instanceId });
    const routed = await ai.request<RouteResult>(Protocol.KERNEL_ROUTE, { instanceId, text: probeCall('echo') });

    assert.deepEqual(routed.operations[0]?.result?.data?.capabilities, ['probe:ai']);
  });

  it('disposes an instance', async () => {
    const boot = await ui.request<KernelBootResult>(Protocol.KERNEL_BOOT, { options: { 'probe.label': 'gone' } });
    const instanceId = boot.instance.instanceId;
    const disposed = await ui.request<KernelDisposeResult>(Protocol.KERNEL_DISPOSE, { instanceId });

    assert.equal(disposed.disposed, true);

    const status = await ui.request<KernelStatusResult>(Protocol.KERNEL_STATUS, { instanceId });
    assert.equal(status.instance, null);
  });

  it('rejects the removed domain methods', async () => {
    for (const method of ['workspace.list', 'actions.list']) {
      await assert.rejects(ui.request(method, {}), (error: unknown) => error instanceof DaemonRpcError);
    }
  });
});

describe('daemon — operator-controlled kernel reuse', () => {
  it('reuses a running kernel for identical options only when the operator allows it', async (t) => {
    const probe = await createProbeHome({ prefix: 'brud-daemon-reuse-', reuseIdenticalBoots: true });
    const daemon = await createDaemon({ home: probe.home, operator: probe.operator, expectedPeerPid: process.pid });
    const client = await connectToDaemon({ home: probe.home, tier: 'ui', spawnIfMissing: false });

    t.after(async () => {
      await client.close();
      await daemon.shutdown();
      await probe.cleanup();
    });

    const first = await client.request<KernelBootResult>(Protocol.KERNEL_BOOT, { options: { 'probe.label': 'same' } });
    const second = await client.request<KernelBootResult>(Protocol.KERNEL_BOOT, { options: { 'probe.label': 'same' } });
    const other = await client.request<KernelBootResult>(Protocol.KERNEL_BOOT, { options: { 'probe.label': 'other' } });

    assert.equal(second.reused, true);
    assert.equal(second.instance.instanceId, first.instance.instanceId);
    assert.notEqual(other.instance.instanceId, first.instance.instanceId);
  });
});

describe('daemon — kernel state isolation', () => {
  it('gives two live kernels with identical options separate state folders', async (t) => {
    const probe = await createProbeHome({ prefix: 'brud-daemon-state-' });
    const daemon = await createDaemon({ home: probe.home, operator: probe.operator, expectedPeerPid: process.pid });
    const client = await connectToDaemon({ home: probe.home, tier: 'ui', spawnIfMissing: false });

    t.after(async () => {
      await client.close();
      await daemon.shutdown();
      await probe.cleanup();
    });

    const first = await client.request<KernelBootResult>(Protocol.KERNEL_BOOT, { options: { 'probe.label': 'twin' } });
    const second = await client.request<KernelBootResult>(Protocol.KERNEL_BOOT, { options: { 'probe.label': 'twin' } });

    assert.equal(second.reused, false);
    assert.notEqual(second.instance.instanceId, first.instance.instanceId);

    const folders = (await readdir(join(probe.home, 'kernels'))).sort();

    assert.equal(folders.length, 2, `each live kernel owns its state folder: ${folders.join(', ')}`);
    assert.equal(new Set(folders).size, 2);

    for (const instance of [first, second]) {
      const routed = await client.request<RouteResult>(Protocol.KERNEL_ROUTE, {
        instanceId: instance.instance.instanceId,
        text: probeCall('echo'),
      });

      assert.equal(routed.status, 'success');
    }

    // A disposed kernel frees its folder name for the next boot.
    await client.request(Protocol.KERNEL_DISPOSE, { instanceId: second.instance.instanceId });
    const third = await client.request<KernelBootResult>(Protocol.KERNEL_BOOT, { options: { 'probe.label': 'twin' } });

    assert.ok(third.instance.instanceId.length > 0);
    assert.equal((await readdir(join(probe.home, 'kernels'))).length, 2);
  });
});
