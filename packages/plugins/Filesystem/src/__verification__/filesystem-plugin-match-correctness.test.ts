/**
 * Goal 8 — Match correctness.
 *
 * The pure matcher and the live search_replace / search_replace_multi tools are
 * both probed. Line-prefixed context and CRLF preservation are explicit.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applySingleMatch,
  findSingleMatch,
  stripNumericLinePrefixes,
} from '../match/index.js';
import {
  acquireVerificationLock,
  bootVerificationKernel,
  errorCode,
  invoke,
  readReal,
  releaseVerificationLock,
  writeReal,
} from './support/harness.test.js';
import type { VerificationKernel } from './support/harness.test.js';

let kernel: VerificationKernel;

before(async () => {
  await acquireVerificationLock();
  kernel = await bootVerificationKernel({ prefix: 'brud-fs-verify-match-' });
});

after(async () => {
  await kernel.shutdown();
  await releaseVerificationLock();
});

describe('Goal 8 — pure matcher', () => {
  it('finds exactly one match', () => {
    const match = findSingleMatch('alpha beta gamma', 'beta');

    assert.equal(match.ok, true);
    if (match.ok) {
      assert.equal(match.value.index, 6);
    }
  });

  it('returns SEARCH_NOT_FOUND for zero matches', () => {
    const match = findSingleMatch('alpha beta', 'missing');

    assert.equal(match.ok, false);
    if (!match.ok) {
      assert.equal(match.code, 'SEARCH_NOT_FOUND');
    }
  });

  it('returns MULTIPLE_MATCHES for two matches', () => {
    const match = findSingleMatch('foo bar foo', 'foo');

    assert.equal(match.ok, false);
    if (!match.ok) {
      assert.equal(match.code, 'MULTIPLE_MATCHES');
    }
  });

  it('replaces exactly the single occurrence', () => {
    const applied = applySingleMatch('alpha beta gamma', 'beta', 'BETA');

    assert.equal(applied.ok, true);
    if (applied.ok) {
      assert.equal(applied.value.content, 'alpha BETA gamma');
    }
  });

  it('strips numeric pipe prefixes from pasted context', () => {
    assert.equal(stripNumericLinePrefixes('1 | alpha\n2 | beta'), 'alpha\nbeta');
    assert.equal(stripNumericLinePrefixes('10| alpha\n20 |beta'), 'alpha\nbeta');
  });

  it('does not strip colon-prefixed content', () => {
    assert.equal(stripNumericLinePrefixes('1: alpha\n2: beta'), '1: alpha\n2: beta');
  });
});

describe('Goal 8 — search_replace tool', () => {
  it('finds and replaces exactly one match', async () => {
    await writeReal(kernel.root, 'match/one.txt', 'alpha beta gamma');
    const result = await invoke(kernel, 'search_replace', {
      path: 'match/one.txt',
      search: 'beta',
      replace: 'BETA',
    });

    assert.equal(result.status, 'success');
    assert.equal(await readReal(kernel.root, 'match/one.txt'), 'alpha BETA gamma');
  });

  it('returns SEARCH_NOT_FOUND for zero matches and writes nothing', async () => {
    await writeReal(kernel.root, 'match/zero.txt', 'alpha beta');
    const result = await invoke(kernel, 'search_replace', {
      path: 'match/zero.txt',
      search: 'missing',
      replace: 'x',
    });

    assert.equal(result.status, 'aborted');
    assert.equal(errorCode(result), 'SEARCH_NOT_FOUND');
    assert.equal(await readReal(kernel.root, 'match/zero.txt'), 'alpha beta');
  });

  it('returns MULTIPLE_MATCHES for two matches and writes nothing', async () => {
    await writeReal(kernel.root, 'match/two.txt', 'foo bar foo');
    const result = await invoke(kernel, 'search_replace', {
      path: 'match/two.txt',
      search: 'foo',
      replace: 'baz',
    });

    assert.equal(result.status, 'aborted');
    assert.equal(errorCode(result), 'MULTIPLE_MATCHES');
    assert.equal(await readReal(kernel.root, 'match/two.txt'), 'foo bar foo');
  });

  it('handles a pipe-prefixed search string', async () => {
    await writeReal(kernel.root, 'match/pipe.txt', '1 | alpha\n2 | beta');
    const result = await invoke(kernel, 'search_replace', {
      path: 'match/pipe.txt',
      search: '1 | alpha',
      replace: 'first',
    });

    assert.equal(result.status, 'success');
    assert.equal(await readReal(kernel.root, 'match/pipe.txt'), '1 | first\n2 | beta');
  });

  it('handles colon-prefixed file content literally', async () => {
    await writeReal(kernel.root, 'match/colon.txt', '1: foo\n2: bar');
    const result = await invoke(kernel, 'search_replace', {
      path: 'match/colon.txt',
      search: 'foo',
      replace: 'baz',
    });

    assert.equal(result.status, 'success');
    assert.equal(await readReal(kernel.root, 'match/colon.txt'), '1: baz\n2: bar');
  });

  it('preserves CRLF line endings', async () => {
    await writeReal(kernel.root, 'match/crlf.txt', 'line one\r\nline two\r\n');
    const result = await invoke(kernel, 'search_replace', {
      path: 'match/crlf.txt',
      search: 'line two',
      replace: 'LINE TWO',
    });

    assert.equal(result.status, 'success');
    assert.equal(await readReal(kernel.root, 'match/crlf.txt'), 'line one\r\nLINE TWO\r\n');
  });

  it('matches multi-line search text exactly', async () => {
    await writeReal(kernel.root, 'match/multiline.txt', 'a\nb\nc\n');
    const result = await invoke(kernel, 'search_replace', {
      path: 'match/multiline.txt',
      search: 'a\nb',
      replace: 'a\nB',
    });

    assert.equal(result.status, 'success');
    assert.equal(await readReal(kernel.root, 'match/multiline.txt'), 'a\nB\nc\n');
  });

  it('treats overlapping occurrences as multiple matches', async () => {
    await writeReal(kernel.root, 'match/overlap.txt', 'aaa');
    const result = await invoke(kernel, 'search_replace', {
      path: 'match/overlap.txt',
      search: 'aa',
      replace: 'x',
    });

    assert.equal(result.status, 'aborted');
    assert.equal(errorCode(result), 'MULTIPLE_MATCHES');
  });

  it('replaces only one of two identical substrings in a longer text', async () => {
    await writeReal(kernel.root, 'match/unique.txt', 'prefix needle suffix');
    const result = await invoke(kernel, 'search_replace', {
      path: 'match/unique.txt',
      search: 'needle',
      replace: 'pin',
    });

    assert.equal(result.status, 'success');
    assert.equal(await readReal(kernel.root, 'match/unique.txt'), 'prefix pin suffix');
  });
});

describe('Goal 8 — search_replace_multi match correctness', () => {
  it('replaces exact matches and skips zero/multiple files', async () => {
    await writeReal(kernel.root, 'match/multi/one.txt', 'alpha beta');
    await writeReal(kernel.root, 'match/multi/zero.txt', 'nothing here');
    await writeReal(kernel.root, 'match/multi/two.txt', 'beta beta');

    const result = await invoke(kernel, 'search_replace_multi', {
      pattern: '**/*.txt',
      scope: 'match/multi',
      search: 'beta',
      replace: 'BETA',
    });

    assert.equal(result.status, 'success');
    const data = result.data as {
      files: Array<{ path: string }>;
      skipped: Array<{ path: string; code?: string }>;
    };

    assert.deepEqual(data.files.map((entry) => entry.path), ['match/multi/one.txt']);
    assert.deepEqual(
      Object.fromEntries(data.skipped.map((entry) => [entry.path, entry.code])),
      {
        'match/multi/two.txt': 'MULTIPLE_MATCHES',
        'match/multi/zero.txt': 'SEARCH_NOT_FOUND',
      },
    );
    assert.equal(await readReal(kernel.root, 'match/multi/one.txt'), 'alpha BETA');
    assert.equal(await readReal(kernel.root, 'match/multi/zero.txt'), 'nothing here');
    assert.equal(await readReal(kernel.root, 'match/multi/two.txt'), 'beta beta');
  });

  it('skips a file with multiple matches with MULTIPLE_MATCHES', async () => {
    await writeReal(kernel.root, 'match/multi-dup/a.txt', 'same same');

    const result = await invoke(kernel, 'search_replace_multi', {
      pattern: '**/*.txt',
      scope: 'match/multi-dup',
      search: 'same',
      replace: 'other',
    });

    assert.equal(result.status, 'success');
    const data = result.data as {
      files: unknown[];
      skipped: Array<{ path: string; code?: string }>;
    };

    assert.equal(data.files.length, 0);
    assert.equal(data.skipped[0]?.path, 'match/multi-dup/a.txt');
    assert.equal(data.skipped[0]?.code, 'MULTIPLE_MATCHES');
    assert.equal(await readReal(kernel.root, 'match/multi-dup/a.txt'), 'same same');
  });

  it('preserves CRLF in multi-file replacements', async () => {
    await writeReal(kernel.root, 'match/multi-crlf/a.txt', 'one\r\ntwo\r\n');

    const result = await invoke(kernel, 'search_replace_multi', {
      pattern: '**/*.txt',
      scope: 'match/multi-crlf',
      search: 'two',
      replace: 'TWO',
    });

    assert.equal(result.status, 'success');
    assert.equal(await readReal(kernel.root, 'match/multi-crlf/a.txt'), 'one\r\nTWO\r\n');
  });
});