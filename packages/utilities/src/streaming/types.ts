export type StreamStatus = 'idle' | 'streaming' | 'completed' | 'aborted' | 'error';

export interface StreamMetrics {
  chunkCount: number;
  charCount: number;
  startTime?: number;
  endTime?: number;
  durationMs: number;
}

export interface BaseStreamerOptions {
  signal?: AbortSignal;
  onStart?: () => void;
  onError?: (error: Error) => void;
  onAbort?: (reason?: string) => void;
}