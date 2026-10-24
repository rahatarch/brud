import { randomBytes } from 'node:crypto';
import type { FileReversalAction } from '../plan_reversal/types.js';
import {
  MissingReversalBytesError,
  ReversalConflictError,
} from './types.js';
import type {
  ExecuteReversalInput,
  ReversalReceipt,
} from './types.js';

function assertExecutable(input: ExecuteReversalInput): void {
  const { plan } = input;

  if (plan.isExecutable !== true || plan.conflicts.length > 0) {
    throw new ReversalConflictError(plan.sessionId, plan.conflicts);
  }
}

function assertRestorable(action: FileReversalAction): void {
  if (action.action === 'restore' && action.targetBytes === null) {
    throw new MissingReversalBytesError(action.relativePath);
  }
}

function createReversalId(): string {
  return `REV-${Date.now()}-${randomBytes(4).toString('hex')}`;
}

/**
 * Applies a previously planned reversal to the workspace.
 *
 * The plan is validated before any mutation. Restore actions write their
 * captured bytes atomically and delete actions remove the target. Afterwards
 * the reversal is recorded in the ledger and the session status is set to
 * `'reverted'`.
 *
 * @param input - Ledger, workspace filesystem, and an executable plan.
 * @returns The audit receipt for the applied reversal.
 */
export async function executeReversal(input: ExecuteReversalInput): Promise<ReversalReceipt> {
  const { ledger, fileSystem, plan } = input;

  assertExecutable(input);

  for (const action of plan.actions) {
    assertRestorable(action);
  }

  let filesRestored = 0;
  let filesDeleted = 0;

  for (const action of plan.actions) {
    if (action.action === 'restore') {
      const targetBytes = action.targetBytes;

      if (targetBytes === null) {
        throw new MissingReversalBytesError(action.relativePath);
      }

      await fileSystem.writeAtomic(action.relativePath, targetBytes);
      filesRestored += 1;
      continue;
    }

    if (await fileSystem.exists(action.relativePath)) {
      await fileSystem.deleteFile(action.relativePath);
      filesDeleted += 1;
    }
  }

  const executedAt = new Date().toISOString();
  const reversalId = createReversalId();

  ledger.recordReversal({
    reversal_id: reversalId,
    session_id: plan.sessionId,
    target_state: plan.targetState,
    executed_at: executedAt,
    status: 'success',
    reverted_operations: JSON.stringify(plan.actions.map((action) => action.relativePath)),
    error_message: null,
  });

  ledger.markSessionReverted(plan.sessionId);

  return {
    reversalId,
    sessionId: plan.sessionId,
    targetState: plan.targetState,
    executedAt,
    filesRestored,
    filesDeleted,
  };
}
