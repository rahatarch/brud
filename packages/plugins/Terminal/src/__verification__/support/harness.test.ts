/**
 * Independent verification harness for the Phase 10 Terminal plugin.
 *
 * This module boots the real standard kernel (source, not the built package)
 * with the real `brud.core.terminal` service and the real validation gate. It
 * imports only the plugin's public factory; no handler is stubbed.
 */
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  IBrudToolsService,
  IPluginExecutionContext,
  OperationResult,
} from '@brud/kernel';
import { createStandardKernel } from '../../../../../kernel/src/bootstrap/index.js';
import type { BrudKernel } from '../../../../../kernel/src/engine/BrudKernel.js';
import { BrudToolsToken } from '../../../../../kernel/services/BrudTools/descriptor/tokens.js';
import {
  DEFAULT_TERMINAL_POLICY,
  type TerminalPolicy,
} from '../../../../../kernel/services/TerminalService/contracts/policies.js';
import { createTerminalPlugin } from '../../plugin.js';

export interface TerminalHarness {
  readonly kernel: BrudKernel;
  readonly root: string;
  readonly tools: IBrudToolsService;
  readonly caller: IPluginExecutionContext;
  execute(
    name: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<OperationResult>;
  run(
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<OperationResult>;
  shutdown(): Promise<void>;
}

export interface TerminalHarnessOptions {
  readonly prefix?: string;
  readonly policy?: Partial<TerminalPolicy>;
}

/** Builds a terminal harness over a real temporary workspace. */
export async function bootTerminalHarness(
  options: TerminalHarnessOptions = {},
): Promise<TerminalHarness> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), options.prefix ?? 'brud-terminal-verification-')),
  );
  const policy = options.policy === undefined
    ? undefined
    : Object.freeze({ ...DEFAULT_TERMINAL_POLICY, ...options.policy, schemaVersion: 1 as const });
  const kernel = createStandardKernel({
    history: { inMemory: true },
    ...(policy === undefined ? {} : { terminal: { policy } }),
    initialPlugins: [createTerminalPlugin()],
  });

  await kernel.boot({ options: { workspaceRoot: root } });

  const caller: IPluginExecutionContext = {
    workspaceRoot: root,
    callerId: 'verification.terminal',
  };
  const tools = kernel.requestAccess(
    { callerId: caller.callerId, tier: 'core', workspaceRoot: root },
    BrudToolsToken,
  );

  return {
    kernel,
    root,
    tools,
    caller,
    execute: (name, input, signal) =>
      tools.executeTool(name, input, {
        ...caller,
        ...(signal === undefined ? {} : { signal }),
      }),
    run: (input, signal) => tools.executeTool('terminal_command', input, {
      ...caller,
      ...(signal === undefined ? {} : { signal }),
    }),
    shutdown: async (): Promise<void> => {
      try {
        await kernel.shutdown();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  };
}

/** Machine-readable terminal code attached by the plugin envelope. */
export function resultCode(result: OperationResult): string | undefined {
  return (result as OperationResult & { readonly code?: string }).code;
}

/** Per-command record carried in `data` for a single or group result. */
export interface CommandData {
  readonly command: string;
  readonly output: string;
  readonly exitCode: number | null;
  readonly duration: number;
  readonly success: boolean;
}

/** Reads a single-command `data` record. */
export function singleData(result: OperationResult): CommandData {
  return result.data as CommandData;
}

/** Reads a group `data` record, including the failure envelope's nested results. */
export function groupData(result: OperationResult): readonly CommandData[] {
  const data = result.data as
    | readonly CommandData[]
    | { readonly results?: readonly CommandData[] }
    | undefined;

  if (Array.isArray(data)) {
    return data;
  }

  return data?.results ?? [];
}

/** Extracts the measured output from a failed single-command envelope. */
export function failureOutput(result: OperationResult): string {
  const message = result.message ?? '';
  const marker = 'Output:\n';
  const index = message.indexOf(marker);

  return index === -1 ? '' : message.slice(index + marker.length);
}

/** Returns the human-readable error text of a failed result. */
export function errorText(result: OperationResult): string {
  if (typeof result.error === 'string') {
    return result.error;
  }

  if (result.error instanceof Error) {
    return result.error.message;
  }

  return result.message ?? '';
}