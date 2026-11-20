import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDaemon, connectToDaemon } from '@brud/daemon';

const here = import.meta.dirname;

const home = await mkdtemp(join(tmpdir(), 'brud-daemon-demo-'));
const hardcores = ['identityRegistry', 'exposedApiRegistry', 'parser', 'router', 'wasmCage', 'events', 'interception']
  .map((name) => ({ path: `kernel:serviceModules/${name}.js`, official: true }));

await writeFile(join(home, 'brud.config.json'), JSON.stringify({
  services: [...hardcores, { path: join(here, 'notes.mjs'), official: true }],
}));
await writeFile(join(home, 'daemon.json'), JSON.stringify({
  composition: './brud.config.json',
  fixedOptions: {},
  clientOptions: [],
  principals: { ui: [], ai: [] },
  reuseIdenticalBoots: false,
}));

const daemon = await createDaemon({ home, expectedPeerPid: process.pid });
const client = await connectToDaemon({ home, tier: 'ui' });

const requirements = await client.request('kernel.requirements');
const boot = await client.request('kernel.boot', { options: {} });
const instanceId = boot.instance.instanceId;
const kinds = await client.request('kernel.kinds', { instanceId });
const routed = await client.request('kernel.route', {
  instanceId,
  text: '[BRUD]\n[CALL note add]\ntext: from the daemon\n[END]\n[CALL note list]\n[END]\n[/BRUD]',
});

console.log(JSON.stringify({ requirements, state: boot.instance.state, reused: boot.reused, pruned: boot.pruned, kinds: kinds.kinds.map((k) => k.kind), status: routed.status, last: routed.operations.at(-1).result.data }));

await client.request('kernel.dispose', { instanceId });
await client.close();
await daemon.shutdown();
