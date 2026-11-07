import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { Buffer } from 'node:buffer';
import * as Protocol from '@brud/protocol';
import type { RpcNotification, RpcRequest } from '@brud/protocol';
import * as Framing from '../server/framing.js';

function request(id: number | string): RpcRequest {
  return {
    jsonrpc: '2.0',
    id,
    method: 'demo.echo',
    params: { id },
  };
}

describe('Ndjson framing', () => {
  it('assembles a frame delivered across multiple chunks', () => {
    const decoder = new Framing.FrameDecoder();
    const frame = Framing.encodeFrame(request(1));
    const splitAt = 9;

    assert.deepEqual(decoder.push(frame.subarray(0, splitAt)), []);
    assert.equal(decoder.pendingBytes, splitAt);

    const messages = decoder.push(frame.subarray(splitAt));

    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0], request(1));
    assert.equal(decoder.pendingBytes, 0);
  });

  it('decodes multiple frames delivered in a single chunk', () => {
    const decoder = new Framing.FrameDecoder();
    const notification: RpcNotification = {
      jsonrpc: '2.0',
      method: 'demo.notify',
      params: { ready: true },
    };
    const chunk = Buffer.concat([
      Framing.encodeFrame(request('a')),
      Framing.encodeFrame(notification),
      Framing.encodeFrame(request('b')),
    ]);

    const messages = decoder.push(chunk);

    assert.equal(messages.length, 3);
    assert.deepEqual(messages[0], request('a'));
    assert.deepEqual(messages[1], notification);
    assert.deepEqual(messages[2], request('b'));
  });

  it('preserves UTF-8 payloads split inside a multi-byte sequence', () => {
    const decoder = new Framing.FrameDecoder();
    const text = 'héllo 🌍 世界';
    const frame = Framing.encodeFrame({
      jsonrpc: '2.0',
      id: 'utf8',
      method: 'demo.echo',
      params: { text },
    });
    const emojiBytes = Buffer.from('🌍', 'utf8');
    const emojiOffset = frame.indexOf(emojiBytes);
    assert.notEqual(emojiOffset, -1);

    const splitAt = emojiOffset + 2;
    assert.deepEqual(decoder.push(frame.subarray(0, splitAt)), []);

    const messages = decoder.push(frame.subarray(splitAt));
    assert.equal(messages.length, 1);

    const message = messages[0];
    assert.ok(Protocol.isRpcRequest(message));
    assert.deepEqual(message.params, { text });
  });

  it('rejects a frame that exceeds the maximum frame size without a delimiter', () => {
    const decoder = new Framing.FrameDecoder();
    const oversize = Buffer.alloc(Framing.MAX_FRAME_BYTES + 1, 0x61);

    assert.throws(
      () => decoder.push(oversize),
      (error: unknown) => {
        assert.ok(error instanceof Framing.FrameError);
        assert.equal(error.code, 'FRAME_OVERSIZE');
        return true;
      },
    );
    assert.equal(decoder.pendingBytes, 0);
  });

  it('rejects a delimited frame that exceeds the maximum frame size', () => {
    const decoder = new Framing.FrameDecoder();
    const oversize = Buffer.alloc(Framing.MAX_FRAME_BYTES + 2, 0x61);
    oversize[oversize.length - 1] = 0x0a;

    assert.throws(
      () => decoder.push(oversize),
      (error: unknown) => {
        assert.ok(error instanceof Framing.FrameError);
        assert.equal(error.code, 'FRAME_OVERSIZE');
        return true;
      },
    );
  });

  it('decodes any JSON payload for downstream JSON-RPC validation', () => {
    const decoder = new Framing.FrameDecoder();

    assert.deepEqual(decoder.push(Buffer.from('{"arbitrary":true}\n', 'utf8')), [
      { arbitrary: true },
    ]);
  });

  it('reports invalid JSON as a parse error', () => {
    const decoder = new Framing.FrameDecoder();

    assert.throws(
      () => decoder.push(Buffer.from('{not-json}\n', 'utf8')),
      (error: unknown) => {
        assert.ok(error instanceof Framing.FrameError);
        assert.equal(error.code, 'FRAME_INVALID_JSON');
        assert.equal(error.rpcCode, Protocol.PARSE_ERROR);
        return true;
      },
    );
  });

  it('isolates a malformed frame while decoding valid peers in the same chunk', () => {
    const decoder = new Framing.FrameDecoder();
    const chunk = Buffer.from(
      [
        JSON.stringify(request(1)),
        '{"jsonrpc":"2.0","id":2,"method":',
        JSON.stringify(request(3)),
        '{broken}',
        JSON.stringify(request(4)),
        '',
      ].join('\n'),
      'utf8',
    );

    const results = decoder.pushFrames(chunk);

    assert.equal(results.length, 5);
    assert.deepEqual(results[0], { ok: true, message: request(1) });
    assert.equal(results[1]?.ok, false);
    assert.deepEqual(results[2], { ok: true, message: request(3) });
    assert.equal(results[3]?.ok, false);
    assert.deepEqual(results[4], { ok: true, message: request(4) });

    const failures = results.filter((result) => !result.ok);

    assert.equal(failures.length, 2);
    assert.deepEqual(
      failures.map((result) => (result.ok ? null : result.frameId)),
      [2, null],
    );
    assert.equal(decoder.pendingBytes, 0);
  });

  it('waits for the newline before parsing a partial frame', () => {
    const decoder = new Framing.FrameDecoder();
    const frame = Framing.encodeFrame(request(9));
    const splitAt = frame.length - 1;

    assert.deepEqual(decoder.pushFrames(frame.subarray(0, splitAt)), []);
    assert.equal(decoder.pendingBytes, splitAt);

    const results = decoder.pushFrames(frame.subarray(splitAt));

    assert.equal(results.length, 1);
    assert.deepEqual(results[0], { ok: true, message: request(9) });
  });

  it('anchors the payload ceiling at 8 MiB of raw socket bytes', () => {
    assert.equal(Framing.MAX_FRAME_BYTES, 8 * 1024 * 1024);
  });
});
