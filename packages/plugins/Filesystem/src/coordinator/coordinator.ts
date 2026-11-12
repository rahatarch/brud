/**
 * Transaction coordinator for every Filesystem mutation.
 *
 * One session is opened before any mutation, the pre-state of every declared
 * target is captured, the caller's mutation runs under a per-target mutex, and
 * the session is committed `completed` or `aborted`. The coordinator never
 * performs an inline rollback: aborted sessions are discarded by the history
 * engine and the user can retry.
 */
import type { OperationResult } from '@brud/kernel';
import type { IBrudFileSystem } from '@brud/service-filesystem';
import type { IUniversalHistoryService } from '@brud/service-history';
import {
  buildFailureEnvelope,
  buildPartialEnvelope,
  buildSuccessEnvelope,
} from '../envelope/index.js';
import type {
  MutationErrorEntry,
  MutationFileEntry,
  MutationResult,
  MutationSkipEntry,
  PreStateEntry,
} from '../envelope/index.js';
import { FilesystemError, toFilesystemError } from '../errors/index.js';
import type { FilesystemErrorCode } from '../errors/index.js';
import { checkDepth } from '../governor/index.js';
import { assertSafeTarget } from '../paths.js';

/** Session identifier shape produced by the kernel history service. */
const SESSION_ID_PATTERN = /^BR-\d{8}-\d{3,4}$/u;

/**
 * Per-key mutex.
 *
 * The kernel filesystem already serializes writes per target. This mutex adds
 * transaction-level serialization so a read-modify-write tool (append,
 * search/replace) cannot interleave with another tool on the same target.
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();

  public async runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const run = previous.then(() => task());
    const tail = run.then(
      () => undefined,
      () => undefined,
    );

    this.tails.set(key, tail);

    try {
      return await run;
    } finally {
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    }
  }

  /**
   * Acquires every key in sorted order, then runs the task.
   *
   * Sorted acquisition makes concurrent multi-key transactions deadlock-free.
   */
  public async runExclusiveMany<T>(
    keys: readonly string[],
    task: () => Promise<T>,
  ): Promise<T> {
    const unique = [...new Set(keys)].sort();

    const acquire = async (index: number): Promise<T> => {
      if (index >= unique.length) {
        return task();
      }

      return this.runExclusive(unique[index]!, () => acquire(index + 1));
    };

    return acquire(0);
  }

  public clear(): void {
    this.tails.clear();
  }
}

/**
 * Process-wide mutex shared by every activation.
 *
 * Two Filesystem plugin instances in one kernel (or two kernels in one
 * process) therefore serialize on the same workspace-relative target instead
 * of racing each other through their own read-modify-write windows.
 */
export const SHARED_MUTEX = new KeyedMutex();

/** Capability surface needed by the coordinator. */
export interface MutationContext {
  getFileSystem(): IBrudFileSystem;
  getUniversalHistory(): IUniversalHistoryService;
  readonly mutex: KeyedMutex;
}

/** Structured result returned by a tool's `apply` closure. */
export interface MutationApplyResult {
  files?: readonly MutationFileEntry[];
  skipped?: readonly MutationSkipEntry[];
  errors?: readonly MutationErrorEntry[];
  message?: string;
}

export interface MutationRequest {
  kind: string;
  /** Every path used for validation, pre-state capture, and mutex keys. */
  targets: readonly string[];
  /**
   * Paths declared to the history session.
   *
   * Directory nodes are never declared because the unified baseline is
   * byte-based; directory tools supply their contained files explicitly.
   */
  sessionTargets?: readonly string[];
  apply: () => Promise<MutationApplyResult | void>;
  files?: readonly MutationFileEntry[];
  message?: string;
}

function dedupe(paths: readonly string[]): string[] {
  return [...new Set(paths)];
}

function isSessionId(value: string): boolean {
  return SESSION_ID_PATTERN.test(value);
}

async function capturePreState(
  fs: IBrudFileSystem,
  targets: readonly string[],
): Promise<PreStateEntry[]> {
  const entries: PreStateEntry[] = [];

  for (const target of targets) {
    const stats = await fs.stat(target);

    if (stats === null) {
      entries.push({ path: target, status: 'missing' });
      continue;
    }

    if (stats.isDirectory) {
      entries.push({ path: target, status: 'directory' });
      continue;
    }

    const bytes = await fs.readFile(target);

    entries.push({
      path: target,
      status: 'file',
      content: Buffer.from(bytes).toString('utf8'),
      size: bytes.byteLength,
    });
  }

  return entries;
}

function deriveFiles(preState: readonly PreStateEntry[]): MutationFileEntry[] {
  return preState
    .filter((entry) => entry.status !== 'directory')
    .map((entry) => ({
      path: entry.path,
      status: entry.status === 'missing' ? 'created' : 'updated',
    }));
}

function operationStatus(code: FilesystemErrorCode): 'aborted' | 'failed' {
  switch (code) {
    case 'EXECUTION_FAILED':
    case 'HISTORY_FAILED':
      return 'failed';
    default:
      return 'aborted';
  }
}

/** Builds a failure result without opening a session. */
export function buildFailureResult(
  kind: string,
  error: unknown,
  fallbackPath?: string,
): OperationResult<MutationResult> {
  const filesystemError = toFilesystemError(error, fallbackPath);
  const entry: MutationErrorEntry = {
    code: filesystemError.code,
    message: filesystemError.message,
    ...(filesystemError.path === undefined ? {} : { path: filesystemError.path }),
  };
  const envelope = buildFailureEnvelope(kind, [entry], {
    message: filesystemError.message,
  });

  return {
    status: operationStatus(filesystemError.code),
    error: `${filesystemError.code}: ${filesystemError.message}`,
    message: filesystemError.message,
    data: envelope,
  };
}

function failureWithSession(
  kind: string,
  error: unknown,
  sessionId: string,
  preState: readonly PreStateEntry[],
  fallbackPath?: string,
): OperationResult<MutationResult> {
  const filesystemError = toFilesystemError(error, fallbackPath);
  const entry: MutationErrorEntry = {
    code: filesystemError.code,
    message: filesystemError.message,
    ...(filesystemError.path === undefined ? {} : { path: filesystemError.path }),
  };
  const envelope = buildFailureEnvelope(kind, [entry], {
    message: filesystemError.message,
    sessionId,
    preState,
  });

  return {
    status: operationStatus(filesystemError.code),
    error: `${filesystemError.code}: ${filesystemError.message}`,
    message: filesystemError.message,
    data: envelope,
  };
}

/**
 * Executes one mutation transaction.
 *
 * Sequence: validate targets -> capture pre-state -> open session -> apply
 * under the per-target mutex -> commit `completed` or `aborted`.
 */
export async function executeMutation(
  context: MutationContext,
  request: MutationRequest,
): Promise<OperationResult<MutationResult>> {
  const targets = dedupe(request.targets);

  for (const target of targets) {
    try {
      assertSafeTarget(target);
      const depth = checkDepth(target);

      if (!depth.ok) {
        throw new FilesystemError(
          'VALIDATION_ERROR',
          target,
          depth.message ?? 'Path is too deep.',
        );
      }
    } catch (error: unknown) {
      return buildFailureResult(request.kind, error, target);
    }
  }

  const fs = context.getFileSystem();
  let preState: PreStateEntry[];

  try {
    preState = await capturePreState(fs, targets);
  } catch (error: unknown) {
    return buildFailureResult(request.kind, error);
  }

  const historyTargets = request.sessionTargets === undefined
    ? preState.filter((entry) => entry.status !== 'directory').map((entry) => entry.path)
    : dedupe(request.sessionTargets);

  let sessionId: string;

  try {
    sessionId = await context
      .getUniversalHistory()
      .beginSession(`filesystem: ${request.kind}`, historyTargets);
  } catch (error: unknown) {
    return buildFailureResult(
      request.kind,
      new FilesystemError(
        'HISTORY_FAILED',
        undefined,
        `Could not open a history session: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      ),
    );
  }

  if (!isSessionId(sessionId)) {
    return buildFailureResult(
      request.kind,
      new FilesystemError(
        'HISTORY_FAILED',
        undefined,
        `Malformed history session identifier: "${sessionId}".`,
      ),
    );
  }

  // A shape-valid identifier is not proof that the history service actually
  // registered the session. Verify it exists and is active before touching the
  // workspace, so a forged identifier cannot leave an unledgered mutation.
  try {
    const session = await context.getUniversalHistory().getSession(sessionId);

    if (session === null || session.sessionId !== sessionId || session.status !== 'active') {
      return buildFailureResult(
        request.kind,
        new FilesystemError(
          'HISTORY_FAILED',
          undefined,
          `History session "${sessionId}" is not registered or is no longer active.`,
        ),
      );
    }
  } catch (error: unknown) {
    return buildFailureResult(
      request.kind,
      new FilesystemError(
        'HISTORY_FAILED',
        undefined,
        `Could not verify history session "${sessionId}": ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      ),
    );
  }

  let applied: MutationApplyResult | void;

  try {
    applied = await context.mutex.runExclusiveMany(targets, request.apply);
  } catch (error: unknown) {
    try {
      await context.getUniversalHistory().commitSession(sessionId, 'aborted');
    } catch {
      // The original mutation failure is the actionable result; a failing
      // commit must not hide it.
    }

    return failureWithSession(request.kind, error, sessionId, preState);
  }

  const files = applied?.files ?? request.files ?? deriveFiles(preState);
  const skipped = applied?.skipped ?? [];
  const errors = applied?.errors ?? [];

  if (errors.length > 0) {
    try {
      await context.getUniversalHistory().commitSession(sessionId, 'aborted');
    } catch {
      // Preserve the operation failure below.
    }

    const first = errors[0]!;
    const envelope = buildFailureEnvelope(request.kind, errors, {
      message: applied?.message ?? first.message,
      sessionId,
      preState,
    });

    return {
      status: operationStatus(first.code as FilesystemErrorCode),
      error: `${first.code}: ${first.message}`,
      message: envelope.message,
      data: envelope,
    };
  }

  try {
    await context.getUniversalHistory().commitSession(sessionId, 'completed');
  } catch (error: unknown) {
    return buildFailureResult(
      request.kind,
      new FilesystemError(
        'HISTORY_FAILED',
        undefined,
        `Mutation succeeded but the history session could not be committed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      ),
    );
  }

  const message = applied?.message ?? request.message;
  const envelope = skipped.length > 0
    ? buildPartialEnvelope(request.kind, files, skipped, {
      ...(message === undefined ? {} : { message }),
      sessionId,
      preState,
    })
    : buildSuccessEnvelope(request.kind, files, {
      ...(message === undefined ? {} : { message }),
      sessionId,
      preState,
    });

  return {
    status: 'success',
    message: envelope.message,
    data: envelope,
  };
}