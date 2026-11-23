import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { admitParticipantManifest } from '@brud/kernel';
import { defineParticipant } from '../src/participant/index.js';

const manifestOf = (extra: Record<string, unknown>) => defineParticipant({ id: 'acme.rich', create: () => ({}), ...extra })().manifest;

describe('defineParticipant declares events, interception and kinds', () => {
  it('carries each declaration into the manifest the kernel admits', () => {
    const manifest = manifestOf({
      exposes: { 'acme.greet': { handle: () => ({}) }, 'acme.kind': { handle: () => ({}) } },
      events: [{ name: 'acme.changed', version: 1, scope: 'runtime' }],
      interceptions: [{ target: 'acme.other', version: 1, stages: ['input', 'output'] }],
      interceptionPoints: [{ exposure: 'acme.greet', version: 1, admit: ['acme.auditor'] }],
      kinds: [{ kind: 'note', exposure: 'acme.kind', version: 1, operations: { add: { permission: { capabilities: ['notes:write'] } } } }],
    });
    const admitted = admitParticipantManifest('acme.rich', manifest);

    assert.deepEqual(admitted.events.map((event) => event.name), ['acme.changed']);
    assert.deepEqual(admitted.interceptions.map((entry) => entry.target), ['acme.other']);
    assert.deepEqual(admitted.interceptionPoints[0]?.admit, ['acme.auditor']);
    assert.deepEqual(admitted.kinds.map((kind) => kind.kind), ['note']);
  });

  it('leaves them out when none is declared', () => {
    const manifest = manifestOf({});

    assert.deepEqual(manifest.events, []);
    assert.equal('interceptions' in manifest, false);
    assert.equal('kinds' in manifest, false);
  });
});
