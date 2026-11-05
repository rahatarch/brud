import type { OperationResult } from '@brud/kernel';
import type { KeyedMutex, MutationContext } from './coordinator/index.js';

/** Capability handles captured once at activation. */
export interface FilesystemRuntime extends MutationContext {
  executeTool(name: string, input: unknown): Promise<OperationResult>;
  readonly mutex: KeyedMutex;
  readonly workspaceRoot: string;
}