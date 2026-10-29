import { describe, it } from 'node:test';
import assert from 'node:assert';
import { StreamBuffer, TRUNCATION_MARKER } from '../engine/StreamBuffer.js';

describe('StreamBuffer ceiling and ordering', () => {
  it('L-5: does not truncate a stream that lands exactly on the ceiling', () => {
    const buffer = new StreamBuffer({ maxBytes: 5 });

    assert.strictEqual(buffer.push('stdout', 'hello'), true);
    assert.strictEqual(buffer.truncated, false);

    const drained = buffer.drain();

    assert.strictEqual(drained.output, 'hello');
    assert.strictEqual(drained.truncated, false);
    assert.strictEqual(drained.droppedChunks, 0);
  });

  it('truncates only when retained bytes exceed the ceiling', () => {
    const buffer = new StreamBuffer({ maxBytes: 5 });

    assert.strictEqual(buffer.push('stdout', 'hello'), true);
    assert.strictEqual(buffer.push('stdout', '!'), false);
    assert.strictEqual(buffer.truncated, true);

    const drained = buffer.drain();

    assert.strictEqual(drained.output, `hello${TRUNCATION_MARKER.replace('{{limit}}', '5')}`);
    assert.strictEqual(drained.droppedChunks, 1);
  });

  it('M-3: drains stdout and stderr in arrival order', () => {
    const buffer = new StreamBuffer({ maxBytes: 1024 });

    buffer.push('stdout', 'out1 ');
    buffer.push('stderr', 'err1 ');
    buffer.push('stdout', 'out2 ');
    buffer.push('stderr', 'err2');

    assert.strictEqual(buffer.drain().output, 'out1 err1 out2 err2');
  });

  it('L-5: slices the crossing chunk at the byte budget without splitting a code point', () => {
    const buffer = new StreamBuffer({ maxBytes: 4 });

    assert.strictEqual(buffer.push('stdout', 'ab'), true);
    assert.strictEqual(buffer.push('stdout', 'éé'), false);

    const drained = buffer.drain();

    assert.ok(drained.output.startsWith('ab'));
    assert.ok(!drained.output.includes('\uFFFD'), 'the cut must not split a multi-byte code point');
    assert.ok(drained.truncated);
  });

  it('invokes onLimitBreached exactly once on the first breach', () => {
    let breaches = 0;
    const buffer = new StreamBuffer({ maxBytes: 4, onLimitBreached: () => breaches++ });

    buffer.push('stdout', 'abcd');
    assert.strictEqual(breaches, 0);
    buffer.push('stdout', 'e');
    assert.strictEqual(breaches, 1);
    buffer.push('stdout', 'f');
    assert.strictEqual(breaches, 1);
  });

  it('counts channel bytes even after the breach', () => {
    const buffer = new StreamBuffer({ maxBytes: 2 });

    buffer.push('stdout', 'abc');
    buffer.push('stderr', 'de');

    assert.strictEqual(buffer.channelBytes('stdout'), 3);
    assert.strictEqual(buffer.channelBytes('stderr'), 2);
  });
});
