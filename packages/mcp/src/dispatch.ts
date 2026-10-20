import * as path from 'path';
import type { BrudKernel } from '@brud/kernel' with { 'resolution-mode': 'import' };
import { normalizeArguments } from './normalize';
import type { NormalizeFailureCode } from './normalize';

export type DispatchFailureCode = NormalizeFailureCode | 'EXECUTION_FAILED' | 'INTERNAL_ERROR';

export interface ToolCallContent {
  readonly type: 'text';
  readonly text: string;
}

export interface ToolCallResult {
  readonly isError: boolean;
  readonly content: ToolCallContent[];
  readonly code?: DispatchFailureCode;
}

export interface DispatchOptions {
  readonly workspaceRoot: string;
  readonly signal?: AbortSignal;
}

interface KernelEnvelope {
  readonly status: string;
  readonly data?: unknown;
  readonly message?: string;
  readonly error?: unknown;
  readonly durationMs?: number;
}

function emptyResult(): { content: ToolCallContent[] } {
  return { content: [{ type: 'text', text: '' }] };
}

export function sanitizeText(text: string, workspaceRoot: string): string {
  const roots = new Set<string>([workspaceRoot]);
  try {
    roots.add(path.resolve(workspaceRoot));
  } catch {
    // ignore resolution failures
  }

  let sanitized = text;
  for (const root of roots) {
    if (!root) {
      continue;
    }
    sanitized = sanitized.split(root + path.sep).join('');
    sanitized = sanitized.split(root).join('.');
  }

  sanitized = sanitized
    .split('\n')
    .filter((line) => !/^\s+at\s+\S+/.test(line))
    .join('\n');

  return sanitized.trim();
}

function formatSuccess(envelope: KernelEnvelope, workspaceRoot: string): string {
  if (typeof envelope.message === 'string' && envelope.message.length > 0) {
    return sanitizeText(envelope.message, workspaceRoot);
  }
  try {
    return sanitizeText(JSON.stringify(envelope.data ?? null, null, 2), workspaceRoot);
  } catch {
    return sanitizeText(String(envelope.data), workspaceRoot);
  }
}

function formatFailureMessage(envelope: KernelEnvelope, workspaceRoot: string): string {
  const parts: string[] = [];
  if (typeof envelope.message === 'string' && envelope.message.length > 0) {
    parts.push(envelope.message);
  } else if (typeof envelope.error === 'string' && envelope.error.length > 0) {
    parts.push(envelope.error);
  }
  const data = envelope.data as { errors?: Array<{ details?: string; friendly?: string }> } | undefined;
  if (data && Array.isArray(data.errors)) {
    for (const error of data.errors) {
      const detail = error?.details ?? error?.friendly;
      if (typeof detail === 'string' && detail.length > 0) {
        parts.push(detail);
      }
    }
  }
  if (parts.length === 0) {
    parts.push('The operation failed without a detailed message.');
  }
  return sanitizeText(Array.from(new Set(parts)).join('\n'), workspaceRoot);
}

function generateReference(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `MCP-${Date.now().toString(36)}-${random}`;
}

export async function dispatchToolCall(
  kernel: BrudKernel,
  kind: string,
  args: unknown,
  options: DispatchOptions,
): Promise<ToolCallResult> {
  const normalized = normalizeArguments(kind, args, options.workspaceRoot);
  if (!normalized.ok) {
    return {
      isError: true,
      code: normalized.code,
      content: [{ type: 'text', text: normalized.message }],
    };
  }

  let envelope: KernelEnvelope;
  try {
    envelope = (await kernel.execute(kind, normalized.input, {
      workspaceRoot: options.workspaceRoot,
      signal: options.signal,
    })) as unknown as KernelEnvelope;
  } catch {
    const reference = generateReference();
    return {
      isError: true,
      code: 'INTERNAL_ERROR',
      content: [
        {
          type: 'text',
          text: `The operation could not be completed. Reference: ${reference}`,
        },
      ],
    };
  }

  if (!envelope || typeof envelope.status !== 'string') {
    const reference = generateReference();
    return {
      isError: true,
      code: 'INTERNAL_ERROR',
      content: [
        {
          type: 'text',
          text: `The operation returned an unrecognized result. Reference: ${reference}`,
        },
      ],
    };
  }

  if (envelope.status === 'success') {
    const { content } = emptyResult();
    content[0] = { type: 'text', text: formatSuccess(envelope, options.workspaceRoot) };
    return { isError: false, content };
  }

  const { content } = emptyResult();
  content[0] = { type: 'text', text: formatFailureMessage(envelope, options.workspaceRoot) };
  return { isError: true, code: 'EXECUTION_FAILED', content };
}
