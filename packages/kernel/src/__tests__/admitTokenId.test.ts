import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { admitParticipantManifest, createServiceToken } from '../../index.js';

const point = (admit: unknown) => ({ interceptionPoints: [{ exposure: 'acme.greet', version: 1, admit }] });

describe('interception admit takes token id strings', () => {
  it('accepts id strings', () => {
    assert.deepEqual(admitParticipantManifest('acme.giver', point(['acme.auditor'])).interceptionPoints[0]?.admit, ['acme.auditor']);
  });

  it('refuses a token object and tells the author to pass its id', () => {
    const token = createServiceToken('acme.auditor');

    assert.throws(
      () => admitParticipantManifest('acme.giver', point([token])),
      (error: Error) => /id strings/u.test(error.message) && /pass its id string \("acme\.auditor"\)/u.test(error.message),
    );
  });

  it('refuses other malformed lists without the token hint', () => {
    assert.throws(() => admitParticipantManifest('acme.giver', point([''])), (error: Error) => /id strings/u.test(error.message) && !/token object/u.test(error.message));
    assert.throws(() => admitParticipantManifest('acme.giver', point(['a', 'a'])), /id strings/u);
  });
});
