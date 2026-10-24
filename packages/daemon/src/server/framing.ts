import { Buffer } from 'node:buffer';
import * as Protocol from '@brud/protocol';

export const MAX_FRAME_BYTES = 48 * 1024 * 1024;

export const FRAME_DELIMITER_BYTE = 0x0a;

export type FrameErrorCode = 'FRAME_OVERSIZE' | 'FRAME_INVALID_JSON';

const RPC_CODE_BY_FRAME_ERROR: Record<FrameErrorCode, Protocol.RpcErrorCode> = {
  FRAME_OVERSIZE: Protocol.INVALID_REQUEST,
  FRAME_INVALID_JSON: Protocol.PARSE_ERROR,
};

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

export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): unknown[] {
    if (chunk.length === 0) {
      return [];
    }

    const combined = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const messages: unknown[] = [];
    let offset = 0;

    try {
      for (;;) {
        const newlineIndex = combined.indexOf(FRAME_DELIMITER_BYTE, offset);
        if (newlineIndex === -1) {
          break;
        }

        const frameLength = newlineIndex - offset;
        if (frameLength > MAX_FRAME_BYTES) {
          throw new FrameError(
            'FRAME_OVERSIZE',
            `Frame exceeds the ${MAX_FRAME_BYTES} byte limit`,
          );
        }

        const frame = combined.subarray(offset, newlineIndex);
        offset = newlineIndex + 1;

        if (frame.length === 0) {
          continue;
        }

        messages.push(this.decodeFrame(frame));
      }

      const remaining = combined.subarray(offset);
      this.buffer = remaining.length === 0 ? Buffer.alloc(0) : Buffer.from(remaining);

      if (this.buffer.length > MAX_FRAME_BYTES) {
        throw new FrameError(
          'FRAME_OVERSIZE',
          `Frame exceeds the ${MAX_FRAME_BYTES} byte limit`,
        );
      }
    } catch (error: unknown) {
      this.buffer = Buffer.alloc(0);
      throw error;
    }

    return messages;
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }

  get pendingBytes(): number {
    return this.buffer.length;
  }

  private decodeFrame(frame: Buffer): unknown {
    try {
      return JSON.parse(frame.toString('utf8'));
    } catch {
      throw new FrameError('FRAME_INVALID_JSON', 'Frame is not valid JSON');
    }
  }
}

export function encodeFrame(message: unknown): Buffer {
  const frame = Buffer.from(`${JSON.stringify(message)}\n`, 'utf8');

  if (frame.length - 1 > MAX_FRAME_BYTES) {
    throw new FrameError('FRAME_OVERSIZE', `Frame exceeds the ${MAX_FRAME_BYTES} byte limit`);
  }

  return frame;
}

export class NdjsonFramingStream {
  private readonly decoder = new FrameDecoder();

  push(chunk: Buffer): unknown[] {
    return this.decoder.push(chunk);
  }

  encode(message: unknown): Buffer {
    return encodeFrame(message);
  }

  reset(): void {
    this.decoder.reset();
  }
}
