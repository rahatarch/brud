import type { StreamStatus, StreamMetrics, BaseStreamerOptions } from './types.js';

export interface ContentStreamerOptions extends BaseStreamerOptions {
  onChunk: (chunk: string, accumulated: string) => void | Promise<void>;
  onDone?: (fullText: string, metrics: StreamMetrics) => void | Promise<void>;
}

export class ContentStreamer {
  private _status: StreamStatus = 'idle';
  private _accumulatedText = '';
  private _chunkCount = 0;
  private _charCount = 0;
  private _startTime?: number;
  private _endTime?: number;
  private _opts: ContentStreamerOptions;
  private _abortHandler: (() => void) | null = null;

  constructor(opts: ContentStreamerOptions) {
    this._opts = opts;

    if (opts.signal) {
      if (opts.signal.aborted) {
        this._status = 'aborted';
        opts.onAbort?.('signal was already aborted');
      } else {
        this._abortHandler = () => {
          this.abort('signal aborted');
        };
        opts.signal.addEventListener('abort', this._abortHandler, { once: true });
      }
    }
  }

  get status(): StreamStatus {
    return this._status;
  }

  get accumulatedText(): string {
    return this._accumulatedText;
  }

  get metrics(): StreamMetrics {
    return {
      chunkCount: this._chunkCount,
      charCount: this._charCount,
      startTime: this._startTime,
      endTime: this._endTime,
      durationMs: this._computeDuration(),
    };
  }

  push(chunk: string): void {
    if (this._status === 'completed' || this._status === 'aborted' || this._status === 'error') {
      return;
    }

    if (this._status === 'idle') {
      this._status = 'streaming';
      this._startTime = Date.now();
      this._opts.onStart?.();
    }

    this._accumulatedText += chunk;
    this._chunkCount++;
    this._charCount += chunk.length;

    this._opts.onChunk(chunk, this._accumulatedText);
  }

  complete(): void {
    if (this._status === 'completed' || this._status === 'aborted' || this._status === 'error') {
      return;
    }

    this._status = 'completed';
    this._endTime = Date.now();
    this._cleanupSignal();

    this._opts.onDone?.(this._accumulatedText, this.metrics);
  }

  abort(reason?: string): void {
    if (this._status === 'aborted' || this._status === 'completed' || this._status === 'error') {
      return;
    }

    this._status = 'aborted';
    this._cleanupSignal();
    this._opts.onAbort?.(reason);
  }

  error(err: Error): void {
    if (this._status === 'error' || this._status === 'completed' || this._status === 'aborted') {
      return;
    }

    this._status = 'error';
    this._cleanupSignal();
    this._opts.onError?.(err);
  }

  reset(): void {
    this._cleanupSignal();
    this._status = 'idle';
    this._accumulatedText = '';
    this._chunkCount = 0;
    this._charCount = 0;
    this._startTime = undefined;
    this._endTime = undefined;

    if (this._opts.signal && !this._opts.signal.aborted) {
      this._abortHandler = () => {
        this.abort('signal aborted');
      };
      this._opts.signal.addEventListener('abort', this._abortHandler, { once: true });
    }
  }

  private _computeDuration(): number {
    if (this._startTime === undefined) return 0;
    const end = this._endTime ?? Date.now();
    return end - this._startTime;
  }

  private _cleanupSignal(): void {
    if (this._abortHandler && this._opts.signal) {
      this._opts.signal.removeEventListener('abort', this._abortHandler);
      this._abortHandler = null;
    }
  }
}