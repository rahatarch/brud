/** Streaming channel a chunk arrived on. */
export type StreamChannel = 'stdout' | 'stderr';

/** One retained chunk, in arrival order. */
export interface StreamChunk {
  readonly channel: StreamChannel;
  readonly text: string;
}

/** Result of draining a buffer. */
export interface StreamDrain {
  /** Decoded, ANSI-stripped output in arrival order. Truncation markers are appended. */
  readonly output: string;
  /** Whether the ceiling was breached. */
  readonly truncated: boolean;
  /** Number of chunks dropped after `maxBytes` was exceeded. */
  readonly droppedChunks: number;
}

/** Options accepted by {@link StreamBuffer}. */
export interface StreamBufferOptions {
  /** Retention ceiling for stdout plus stderr, in bytes. */
  readonly maxBytes: number;
  /**
   * Invoked once, synchronously, when retained output first exceeds the
   * ceiling. The process manager uses it to hard-kill the producing tree.
   */
  readonly onLimitBreached?: () => void;
}

/** Marker appended to a stream that breached the ceiling. */
export const TRUNCATION_MARKER = '\n[output truncated: ceiling of {{limit}} bytes reached]\n';

/**
 * Bounded, channel-tagged stdout/stderr accumulator.
 *
 * The buffer keeps at most `maxBytes` of combined text. It counts bytes on
 * arrival so a fast producer cannot allocate an unbounded string before the
 * ceiling is noticed; the chunk that crosses the ceiling is cut at the byte
 * boundary, the truncation marker is appended, and every later chunk is
 * dropped and counted. Chunks are retained in a single arrival-ordered list,
 * so an interleaved transcript drains exactly as the child emitted it.
 */
export class StreamBuffer {
  private readonly maxBytes: number;

  private readonly onLimitBreached: (() => void) | undefined;

  /** Retained chunks, strictly in the order they were pushed. */
  private readonly chunks: StreamChunk[] = [];

  private retainedBytes = 0;

  private droppedChunks = 0;

  private stdoutBytes = 0;

  private stderrBytes = 0;

  private breached = false;

  /** Bytes a fully retained push has contributed, for the exact-boundary check. */
  private admittedBytes = 0;

  /**
   * @param options - Retention ceiling and breach callback.
   */
  constructor(options: StreamBufferOptions) {
    this.maxBytes = Math.max(0, Math.floor(options.maxBytes));
    this.onLimitBreached = options.onLimitBreached;
  }

  /** Bytes retained so far. */
  get bytes(): number {
    return this.retainedBytes;
  }

  /** Whether the ceiling was exceeded. */
  get truncated(): boolean {
    return this.breached;
  }

  /** Bytes counted per channel, before truncation. */
  channelBytes(channel: StreamChannel): number {
    return channel === 'stdout' ? this.stdoutBytes : this.stderrBytes;
  }

  /**
   * Appends one chunk, cutting it at the remaining budget.
   *
   * @param channel - Arrival channel.
   * @param chunk - Raw chunk text.
   * @returns `true` when the chunk was retained fully.
   */
  push(channel: StreamChannel, chunk: string): boolean {
    if (chunk.length === 0) {
      return true;
    }

    if (channel === 'stdout') {
      this.stdoutBytes += Buffer.byteLength(chunk);
    } else {
      this.stderrBytes += Buffer.byteLength(chunk);
    }

    if (this.breached) {
      this.droppedChunks++;

      return false;
    }

    const size = Buffer.byteLength(chunk);
    // The ceiling is a *breach*, not a boundary: a stream that lands exactly
    // on `maxBytes` was not truncated. The comparison uses the cumulative
    // admitted size rather than the retained size, because the crossing chunk
    // is retained only up to the budget.
    const admittedAfter = this.admittedBytes + size;

    if (admittedAfter <= this.maxBytes) {
      this.admittedBytes = admittedAfter;
      this.chunks.push(Object.freeze({ channel, text: chunk }));
      this.retainedBytes += size;

      return true;
    }

    const remaining = Math.max(0, this.maxBytes - this.retainedBytes);
    const cut = remaining > 0 ? sliceUtf8(chunk, remaining) : '';

    if (cut.length > 0) {
      this.chunks.push(Object.freeze({ channel, text: cut }));
      this.retainedBytes += Buffer.byteLength(cut);
    }

    this.droppedChunks++;
    this.breach();

    return false;
  }

  /**
   * Drains the retained text in the exact order chunks arrived.
   *
   * Every channel is ANSI-stripped after the arrival-ordered join so escape
   * sequences cannot leak into the result.
   */
  drain(): StreamDrain {
    const combined = this.chunks.map((chunk) => chunk.text).join('');
    const stripped = stripAnsiCodes(combined);

    if (!this.breached) {
      return { output: stripped, truncated: false, droppedChunks: 0 };
    }

    return {
      output: stripped + TRUNCATION_MARKER.replace('{{limit}}', String(this.maxBytes)),
      truncated: true,
      droppedChunks: this.droppedChunks,
    };
  }

  /** Records the first breach and signals the producer exactly once. */
  private breach(): void {
    if (this.breached) {
      return;
    }

    this.breached = true;
    this.onLimitBreached?.();
  }
}

/**
 * Removes ANSI escape sequences and control characters.
 *
 * @param value - Raw text.
 */
export function stripAnsiCodes(value: string): string {
  let stripped = value;

  if (stripped.includes('\x1b') || stripped.includes('\x08')) {
    stripped = stripped
      .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1B\][0-9;]*\x07/g, '')
      .replace(/\x1B\].*?\x1B\\/g, '')
      .replace(/\x08/g, '')
      .replace(/\x1B\[K/g, '');
  }

  return stripped.replace(/\r/g, '');
}

/**
 * Cuts a string at a byte budget without splitting a code point.
 *
 * @param value - Source string.
 * @param limit - Byte budget.
 */
function sliceUtf8(value: string, limit: number): string {
  const buffer = Buffer.from(value, 'utf8');

  if (buffer.length <= limit) {
    return value;
  }

  let end = limit;

  while (end > 0 && (buffer[end] & 0xc0) === 0x80) {
    end--;
  }

  return buffer.subarray(0, end).toString('utf8');
}
