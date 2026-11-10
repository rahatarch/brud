import { Buffer } from 'node:buffer';
import * as Protocol from '@brud/protocol';

/**
 * Hard ceiling for one raw newline-delimited frame, measured on the bytes that
 * arrive from the socket before any JSON parsing happens.
 *
 * 8 MiB is deliberately smaller than the kernel mutation governor so a large
 * payload is rejected at the transport boundary instead of being materialized
 * as a JavaScript object first.
 */
export const MAX_FRAME_BYTES = 8 * 1024 * 1024;

export const FRAME_DELIMITER_BYTE = 0x0a;

export type FrameErrorCode = 'FRAME_OVERSIZE' | 'FRAME_INVALID_JSON';

const RPC_CODE_BY_FRAME_ERROR: Record<FrameErrorCode, Protocol.RpcErrorCode> = {
  FRAME_OVERSIZE: Protocol.INVALID_REQUEST,
  FRAME_INVALID_JSON: Protocol.PARSE_ERROR,
};

const OVERSIZE_MESSAGE = `Payload too large: frame exceeds the ${MAX_FRAME_BYTES} byte limit`;

export class FrameError extends Error {
  readonly code: FrameErrorCode;

  readonly rpcCode: Protocol.RpcErrorCode;

  constructor(code: FrameErrorCode, message: string) {
    super(message);
    this.name = 'FrameError';
    this.code = code;
    this.rpcCode = RPC_CODE_BY_FRAME_ERROR[code];
  }
}

/** One decoded frame, or the parse failure that belongs to it. */
export type FrameResult =
  | { readonly ok: true; readonly message: unknown }
  | { readonly ok: false; readonly error: FrameError; readonly frameId: Protocol.JsonRpcId };

function extractFrameId(frame: string): Protocol.JsonRpcId {
  const match = /"id"\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|null)/u.exec(frame);

  if (match === null) {
    return null;
  }

  const raw = match[1] as string;

  if (raw === 'null') {
    return null;
  }

  try {
    const value: unknown = JSON.parse(raw);

    return typeof value === 'string' || typeof value === 'number' ? value : null;
  } catch {
    return null;
  }
}

export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  /**
   * Push surface: decodes every complete frame and throws the first
   * frame error after the chunk has been consumed.
   *
   * The daemon server uses {@link pushFrames} so one malformed frame cannot
   * discard valid peers. This method remains for client-side consumers and
   * frame tests that treat a bad frame as fatal.
   */
  push(chunk: Buffer): unknown[] {
    const results = this.pushFrames(chunk);
    const messages: unknown[] = [];

    for (const result of results) {
      if (!result.ok) {
        throw result.error;
      }

      messages.push(result.message);
    }

    return messages;
  }

  /**
   * Decodes every complete NDJSON frame in `chunk`.
   *
   * Only a complete frame (one terminated by `\n`) is ever handed to
   * `JSON.parse`. A malformed complete frame becomes a per-frame failure that
   * names the frame id when the raw bytes expose one; the decoder then keeps
   * scanning the same chunk so valid frames that follow are still delivered.
   *
   * An oversize frame is a frame-length violation: it throws
   * {@link FrameError} `FRAME_OVERSIZE` after clearing the buffer, which lets
   * the connection reject the payload and close.
   */
  pushFrames(chunk: Buffer): FrameResult[] {
    if (chunk.length === 0) {
      return [];
    }

    const combined = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const results: FrameResult[] = [];
    let offset = 0;

    try {
      for (;;) {
        const newlineIndex = combined.indexOf(FRAME_DELIMITER_BYTE, offset);
        if (newlineIndex === -1) {
          break;
        }

        const frameLength = newlineIndex - offset;
        if (frameLength > MAX_FRAME_BYTES) {
          throw new FrameError('FRAME_OVERSIZE', OVERSIZE_MESSAGE);
        }

        const frame = combined.subarray(offset, newlineIndex);
        offset = newlineIndex + 1;

        if (frame.length === 0) {
          continue;
        }

        results.push(this.decodeFrame(frame));
      }

      const remaining = combined.subarray(offset);
      this.buffer = remaining.length === 0 ? Buffer.alloc(0) : Buffer.from(remaining);

      if (this.buffer.length > MAX_FRAME_BYTES) {
        throw new FrameError('FRAME_OVERSIZE', OVERSIZE_MESSAGE);
      }
    } catch (error: unknown) {
      this.buffer = Buffer.alloc(0);
      throw error;
    }

    return results;
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }

  get pendingBytes(): number {
    return this.buffer.length;
  }

  private decodeFrame(frame: Buffer): FrameResult {
    const text = frame.toString('utf8');

    try {
      return { ok: true, message: JSON.parse(text) };
    } catch {
      return {
        ok: false,
        error: new FrameError('FRAME_INVALID_JSON', 'Frame is not valid JSON'),
        frameId: extractFrameId(text),
      };
    }
  }
}

export function encodeFrame(message: unknown): Buffer {
  const frame = Buffer.from(`${JSON.stringify(message)}\n`, 'utf8');

  if (frame.length - 1 > MAX_FRAME_BYTES) {
    throw new FrameError('FRAME_OVERSIZE', OVERSIZE_MESSAGE);
  }

  return frame;
}

export class NdjsonFramingStream {
  private readonly decoder = new FrameDecoder();

  push(chunk: Buffer): unknown[] {
    return this.decoder.push(chunk);
  }

  pushFrames(chunk: Buffer): FrameResult[] {
    return this.decoder.pushFrames(chunk);
  }

  encode(message: unknown): Buffer {
    return encodeFrame(message);
  }

  reset(): void {
    this.decoder.reset();
  }
}