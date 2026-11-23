import type { Token } from './container.js';
import type { ExecutionContext } from './context.js';

export interface OperationResult<TData = unknown> {
  status: "success" | "failed" | "aborted" | "skipped";
  data?: TData;
  message?: string;
  error?: Error | string;
  durationMs?: number;
}

export interface PromptDescriptor {
  readonly description: string;
  readonly syntaxGuide?: string;
  readonly systemPromptFragment?: string;
  readonly examples?: readonly string[];
}

export interface OperationHandler<TInput = unknown, TOutput = unknown> {
  readonly kind: string;
  readonly requiredCapabilities?: readonly Token<unknown>[];
  readonly promptDescriptor?: PromptDescriptor;
  execute(context: ExecutionContext, input: TInput): Promise<OperationResult<TOutput>>;
}