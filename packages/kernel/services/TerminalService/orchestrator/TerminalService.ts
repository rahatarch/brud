import type { ValidationDecision } from '../../ValidationService/contracts/errors.js';
import type { IServiceLifecycle } from '../../../src/contracts/lifecycle.js';
import type { KernelLogger } from '../../../src/contracts/lifecycle.js';
import {
  legacyCodeFor,
  terminalFailure,
  terminalFailureFromValidation,
  terminalSuccess,
  terminalUnavailable,
  type TerminalDecision,
  type TerminalErrorCode,
} from '../contracts/errors.js';
import type {
  ITerminalService,
  TerminalChunkCallback,
  TerminalCommandGroup,
  TerminalConditionalCommand,
  TerminalExecutedCommand,
  TerminalGroupOutcome,
  TerminalResult,
  TerminalRunMode,
  TerminalRunOptions,
  TerminalRunFailure,
  TerminalRunOutcome,
  TerminalRunRequest,
  TerminalSessionControls,
  TerminalSessionInfo,
  TerminalStatus,
} from '../contracts/ITerminalService.js';
import { DEFAULT_TERMINAL_POLICY, type TerminalPolicy } from '../contracts/policies.js';
import {
  ProcessManager,
  type ChildProcessLike,
  type ManagedExit,
  type SpawnHandle,
} from '../engine/ProcessManager.js';
import { SessionRegistry, sessionInfo } from '../engine/SessionRegistry.js';
import { StreamBuffer } from '../engine/StreamBuffer.js';

/** Validation authority the orchestrator re-checks every command against. */
export interface TerminalValidatorPort {
  /**
   * Validates a shell command and its working directory.
   *
   * @param command - Command text.
   * @param cwd - Working directory.
   */
  validateCommand(command: string, cwd?: string): ValidationDecision;
}

/** Options accepted by {@link TerminalService}. */
export interface TerminalServiceOptions {
  /** Frozen policy. Defaults to {@link DEFAULT_TERMINAL_POLICY}. */
  readonly policy?: TerminalPolicy;
  /**
   * Validation authority. When absent, the service is unbound and fails every
   * execution closed with `TERMINAL_UNAVAILABLE`; there is no structural
   * fallback.
   */
  readonly validator?: TerminalValidatorPort;
  /** Initial workspace root, used when a request omits `cwd`. */
  readonly workspaceRoot?: string;
  /** Process manager override. Intended for tests and alternate platforms. */
  readonly processes?: ProcessManager;
  /** Diagnostic sink for non-fatal warnings. */
  readonly logger?: KernelLogger;
  /**
   * Reserved for unit tests that exercise the engine in isolation without a
   * validation authority. Never set it in a production composition: a flag
   * on the instance is required in addition, so it cannot arrive through
   * deserialized options.
   */
  readonly __allowUnsafeTestExecution?: boolean;
}

/** Quiet period after which the next interactive answer is written. */
const ANSWER_QUIESCENCE_MS = 250;

/** A request that survived validation and environment sanitation. */
interface AdmittedRequest {
  readonly mode: TerminalRunMode;
  readonly command: string;
  readonly commands: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly env: Readonly<Record<string, string>>;
  readonly stopOnFailure: boolean;
  readonly answers: readonly string[];
  readonly onSuccess?: TerminalCommandGroup;
  readonly onFailure?: TerminalCommandGroup;
  readonly callerId?: string;
  /**
   * Stream receiver of the request. Mutable so a consumer that throws is
   * detached after its first fault instead of aborting every later chunk.
   */
  onChunk?: TerminalChunkCallback;
  readonly signal?: AbortSignal;
  /**
   * Session-wide stream index shared by every command of the request, so a
   * batch reports one monotonic `chunkIndex` sequence rather than restarting
   * it per command.
   */
  readonly stream: StreamCursor;
}

/** Mutable arrival cursor shared by every command of one admitted request. */
interface StreamCursor {
  next: number;
}

/** Streaming bookkeeping for one command. */
interface CommandJob {
  consumed: number;
  truncated: boolean;
}

/**
 * A synchronous spawn throw, carried alongside the outcome.
 *
 * `TerminalRunFailure` has no `TERMINAL_INTERNAL` member, so the throwing
 * message is attached to the outcome and projected onto the failure decision.
 */
interface InternalFailureCarrier {
  readonly internalFailure: string;
}

/**
 * Terminal execution orchestrator.
 *
 * The lifecycle is fixed: validate the request shape and every command →
 * sanitize the environment → admit the request against the concurrency
 * governor → spawn through {@link ProcessManager} → stream through
 * {@link StreamBuffer} → assemble a {@link TerminalDecision}.
 */
export class TerminalService implements ITerminalService, IServiceLifecycle {
  private readonly registry = new SessionRegistry();

  private readonly manager: ProcessManager;

  private validator: TerminalValidatorPort | undefined;

  private readonly logger: KernelLogger | undefined;

  private readonly listeners: Array<{ event: 'exit' | 'SIGINT' | 'SIGTERM'; handler: () => void }> = [];

  /**
   * Whether tests asked for execution without a validation authority. This is
   * private and unexported on the type so no typed caller can observe or pass
   * it; only the explicit `__allowUnsafeTestExecution` option sets it.
   */
  private readonly unsafeTestExecution: boolean;

  private policy: TerminalPolicy;

  private workspaceRoot: string | undefined;

  private activeChildren = 0;

  /** Resolvers waiting for a concurrency slot, in arrival order. */
  private readonly waiting: Array<() => void> = [];

  private readonly answerTimers = new Map<string, () => void>();

  /**
   * Measured terminating signal of every outcome produced by this instance.
   * `TerminalRunOutcome` carries no signal, so the projected failure reads it
   * here. A `WeakMap` keeps concurrent requests isolated: a signal is only
   * visible to the decision that projects its own outcome.
   */
  private readonly outcomeSignals = new WeakMap<object, string | null>();

  /**
   * @param options - Policy, validator, workspace, manager and logger.
   */
  constructor(options?: TerminalServiceOptions) {
    this.policy = options?.policy ?? DEFAULT_TERMINAL_POLICY;
    this.validator = options?.validator;
    this.unsafeTestExecution = options?.__allowUnsafeTestExecution === true;
    this.workspaceRoot = options?.workspaceRoot;
    this.manager = options?.processes ?? new ProcessManager();
    this.logger = options?.logger;
  }

  /**
   * Rebinds the frozen policy, workspace root and validator at boot.
   *
   * The access broker only serves while the kernel is RUNNING, so the
   * composition calls this while the broker gate is suspended, exactly as the
   * validation service pins its boot policy.
   *
   * @param bindings - Policy, validator and workspace root.
   */
  pinBootPolicy(bindings: {
    readonly policy: TerminalPolicy;
    readonly validator?: TerminalValidatorPort;
    readonly workspaceRoot?: string;
  }): void {
    this.policy = bindings.policy;
    this.workspaceRoot = bindings.workspaceRoot;

    if (bindings.validator !== undefined) {
      this.validator = bindings.validator;
    }
  }

  /** Lifecycle hook: installs host-termination reapers. */
  initialize(): void {
    this.installTerminationHandlers();
  }

  /** Lifecycle hook: kills every session and removes host hooks. */
  async dispose(): Promise<void> {
    this.killAll();
    this.registry.drain();
    this.removeTerminationHandlers();
  }

  /** Frozen policy this instance enforces. */
  getPolicy(): TerminalPolicy {
    return this.policy;
  }

  /** The process manager this service owns. */
  get processes(): ProcessManager {
    return this.manager;
  }

  /** The session registry this service owns. */
  get sessions(): SessionRegistry {
    return this.registry;
  }

  async run(request: TerminalRunRequest, options?: TerminalRunOptions): Promise<TerminalDecision> {
    const admitted = this.admit(request, options);

    if (!this.isAdmitted(admitted)) {
      return admitted;
    }

    const outcome = await this.dispatch(admitted);

    return this.decide(outcome, admitted);
  }

  registerExternal(session: TerminalSessionInfo, controls?: TerminalSessionControls): void {
    this.registry.register(session, controls);
  }

  registerChild(child: ChildProcessLike, onChunk?: TerminalChunkCallback): string {
    const sessionId = this.manager.nextSessionId();
    const info = sessionInfo(sessionId, 'single', 'legacy', {
      ...(child.pid === undefined ? {} : { pid: child.pid }),
    });
    this.registry.register(info, {
      terminate: () => {
        this.manager.forceKill(child, child.pid, false);
      },
      ...(onChunk === undefined ? {} : { onChunk }),
    });

    const cleanup = (): void => {
      this.registry.remove(sessionId);
    };

    child.once?.('close', cleanup);
    child.once?.('error', cleanup);

    return sessionId;
  }

  kill(sessionId: string): boolean {
    const record = this.registry.get(sessionId);

    if (record === undefined) {
      return false;
    }

    const killed = this.manager.kill(sessionId);

    if (!killed) {
      record.controls?.terminate();
    }

    this.registry.remove(sessionId);

    return true;
  }

  killAll(): number {
    const count = this.manager.killAll();

    for (const record of this.registry.drain()) {
      record.controls?.terminate();
    }

    return count;
  }

  activeSessions(): readonly TerminalSessionInfo[] {
    return this.registry.list();
  }

  chunkCallback(sessionId: string): TerminalChunkCallback | undefined {
    return this.registry.chunkCallback(sessionId);
  }

  hasSession(sessionId: string): boolean {
    return this.registry.has(sessionId);
  }

  unregister(sessionId: string): void {
    this.registry.remove(sessionId);
  }

  private admit(
    request: TerminalRunRequest,
    options?: TerminalRunOptions,
  ): AdmittedRequest | TerminalDecision {
    const mode = request.mode ?? 'single';
    const shape = this.checkShape(request, mode);

    if (shape !== undefined) {
      return shape;
    }

    if (!this.isValidationAuthorityBound()) {
      return terminalUnavailable(request.command ?? request.commands?.[0], request.cwd);
    }

    if (options?.signal?.aborted) {
      return this.interrupted(request.command ?? request.commands?.[0] ?? '', request.cwd);
    }

    const cwd = this.resolveCwd(request.cwd);

    if (typeof cwd !== 'string') {
      return cwd;
    }

    const primary = request.command ?? '';
    const gate = this.validateAll(request, cwd);

    if (gate !== undefined) {
      return gate;
    }

    const environment = this.manager.environment(this.policy, request.env);

    if (!environment.ok) {
      return terminalFailure({
        code: environment.code,
        legacyCode: 'INVALID_FIELD',
        friendly: 'The terminal environment contains a rejected entry.',
        details: environment.message,
        command: primary,
        cwd,
        actionable: true,
        retryable: false,
        metadata: { rejectedKeys: environment.keys.join(',') },
      });
    }

    const requestedTimeout = request.timeoutMs ?? this.policy.defaultTimeoutMs;
    const timeoutMs = Math.min(Math.max(1, Math.floor(requestedTimeout)), this.policy.maxTimeoutMs);

    return {
      mode,
      command: primary,
      commands: Object.freeze([...(request.commands ?? [])]),
      cwd,
      timeoutMs,
      env: environment.env,
      stopOnFailure: request.stopOnFailure === true,
      answers: Object.freeze([...(request.answers ?? [])]),
      ...(request.onSuccess === undefined ? {} : { onSuccess: request.onSuccess }),
      ...(request.onFailure === undefined ? {} : { onFailure: request.onFailure }),
      ...(request.callerId === undefined ? {} : { callerId: request.callerId }),
      ...(options?.onChunk === undefined ? {} : { onChunk: options.onChunk }),
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
      stream: { next: 0 },
    };
  }

  private checkShape(request: TerminalRunRequest, mode: TerminalRunMode): TerminalDecision | undefined {
    const batch = mode === 'sequential' || mode === 'parallel';

    if (batch) {
      const commands = request.commands;

      if (!Array.isArray(commands) || commands.length === 0) {
        return this.invalid('A batch terminal request must carry at least one command.', request.cwd);
      }

      if (commands.length > this.policy.maxBatchCommands) {
        return terminalFailure({
          code: 'TERMINAL_INVALID_REQUEST',
          legacyCode: 'BATCH_LIMIT_EXCEEDED',
          friendly: 'The terminal batch is too large.',
          details: `The request carries ${commands.length} commands; at most ${this.policy.maxBatchCommands} may run in one batch.`,
          cwd: request.cwd,
          actionable: true,
          retryable: false,
          metadata: { limit: this.policy.maxBatchCommands, count: commands.length },
        });
      }

      // `commands` is typed as strings on the public request, but a
      // JavaScript caller can hand any array; scan the raw entries.
      const entries = commands as readonly unknown[];

      for (const entry of entries) {
        if (typeof entry !== 'string') {
          return this.invalid('Every entry of `commands` must be a string.', request.cwd);
        }
      }

      return undefined;
    }

    if (typeof request.command !== 'string') {
      return this.invalid('A terminal request must carry a command.', request.cwd);
    }

    return undefined;
  }

  private resolveCwd(cwd: string | undefined): string | TerminalDecision {
    if (cwd !== undefined && cwd.trim().length > 0) {
      return cwd;
    }

    if (this.workspaceRoot !== undefined) {
      return this.workspaceRoot;
    }

    return this.invalid('The terminal request has no resolvable working directory.', cwd);
  }

  private validateAll(request: TerminalRunRequest, cwd: string): TerminalDecision | undefined {
    const commands: string[] = [];

    if (request.mode === 'sequential' || request.mode === 'parallel') {
      commands.push(...(request.commands ?? []));
    } else {
      commands.push(request.command ?? '');
    }

    if (request.mode === 'conditional') {
      collectGroup(request.onSuccess, commands);
      collectGroup(request.onFailure, commands);
    }

    for (const command of commands) {
      const rejection = this.validateCommand(command, cwd);

      if (rejection !== undefined) {
        return rejection;
      }
    }

    return undefined;
  }

  /**
   * Reports whether the service is bound to a live validation authority.
   *
   * A test-only engine harness is reported as bound because it is the sole
   * caller authorized to execute without one.
   */
  private isValidationAuthorityBound(): boolean {
    return this.validator !== undefined || this.unsafeTestExecution;
  }

  /**
   * Validates one command against the kernel gate.
   *
   * Validation is fail-closed: an unbound authority refuses every command
   * with `TERMINAL_UNAVAILABLE` instead of falling back to a structural check.
   *
   * @param command - Command text.
   * @param cwd - Working directory.
   */
  validateCommand(command: string, cwd: string): TerminalDecision | undefined {
    const worker = this.validator;

    if (worker === undefined) {
      if (this.unsafeTestExecution) {
        return undefined;
      }

      return terminalUnavailable(command, cwd);
    }

    try {
      const decision = worker.validateCommand(command, cwd);

      if (decision.ok) {
        return undefined;
      }

      return terminalFailureFromValidation(decision, command);
    } catch (error) {
      // A faulty validator is a driver failure, not a caller error: it must
      // degrade to a structured decision so `run()` still resolves and the
      // request is refused rather than surfacing as a rejected promise.
      const message = error instanceof Error ? error.message : String(error);
      this.logger?.warn(`TerminalService: validation authority threw (${message}); refusing the command.`);

      return terminalFailure({
        code: 'TERMINAL_INTERNAL',
        legacyCode: 'INTERNAL_ERROR',
        friendly: 'Validation authority failed unexpectedly',
        details: message,
        command,
        cwd,
        actionable: false,
        retryable: true,
        exitCode: null,
        signal: null,
      });
    }
  }

  private async dispatch(admitted: AdmittedRequest): Promise<TerminalResult> {
    switch (admitted.mode) {
      case 'interactive':
        return this.executeInteractive(admitted);
      case 'sequential':
        return this.executeSequential(admitted);
      case 'parallel':
        return this.executeParallel(admitted);
      case 'conditional':
        return this.executeConditional(admitted);
      case 'single':
      default:
        return this.executeSingle(admitted);
    }
  }

  private async executeSingle(admitted: AdmittedRequest): Promise<TerminalRunOutcome> {
    return this.executeOne(admitted.command, admitted);
  }

  private async executeInteractive(admitted: AdmittedRequest): Promise<TerminalRunOutcome> {
    return this.executeOne(admitted.command, admitted, admitted.answers);
  }

  private async executeSequential(admitted: AdmittedRequest): Promise<TerminalGroupOutcome> {
    const results: TerminalExecutedCommand[] = [];

    for (const command of admitted.commands) {
      const outcome = await this.executeOne(command, admitted);
      results.push(toExecuted(command, outcome));

      if (!outcome.success && (admitted.stopOnFailure || outcome.status === 'interrupted')) {
        break;
      }
    }

    return {
      success: results.every((result) => result.success),
      results,
      totalDuration: results.reduce((sum, result) => sum + result.duration, 0),
    };
  }

  private async executeParallel(admitted: AdmittedRequest): Promise<TerminalGroupOutcome> {
    const results = await Promise.all(
      admitted.commands.map(async (command) => toExecuted(command, await this.executeOne(command, admitted))),
    );

    return {
      success: results.every((result) => result.success),
      results,
      totalDuration: results.reduce((max, result) => Math.max(max, result.duration), 0),
    };
  }

  private async executeConditional(admitted: AdmittedRequest): Promise<TerminalGroupOutcome> {
    const conditional: TerminalConditionalCommand = {
      command: admitted.command,
      ...(admitted.onSuccess === undefined ? {} : { onSuccess: admitted.onSuccess }),
      ...(admitted.onFailure === undefined ? {} : { onFailure: admitted.onFailure }),
    };
    const primary = await this.executeOne(conditional.command, admitted);
    const results: TerminalExecutedCommand[] = [toExecuted(conditional.command, primary)];
    const branch = primary.success ? conditional.onSuccess : conditional.onFailure;

    if (branch !== undefined) {
      results.push(...(await this.executeGroup(branch, admitted)));
    }

    return {
      success: results.every((result) => result.success),
      results,
      totalDuration: results.reduce((sum, result) => sum + result.duration, 0),
    };
  }

  private async executeGroup(
    group: TerminalCommandGroup,
    admitted: AdmittedRequest,
  ): Promise<readonly TerminalExecutedCommand[]> {
    const strings: string[] = [];
    const nested: TerminalCommandGroup[] = [];

    for (const entry of group.commands) {
      if (typeof entry === 'string') {
        strings.push(entry);
      } else {
        nested.push(entry);
      }
    }

    const results: TerminalExecutedCommand[] = [];

    if (strings.length > 0) {
      const batchAdmitted: AdmittedRequest = {
        ...admitted,
        mode: group.type,
        commands: strings,
        stopOnFailure: group.stopOnFailure === true,
      };
      const batch = group.type === 'parallel'
        ? await this.executeParallel(batchAdmitted)
        : await this.executeSequential(batchAdmitted);
      results.push(...batch.results);
    }

    for (const child of nested) {
      results.push(...(await this.executeGroup(child, admitted)));
    }

    return results;
  }

  /** Outcome of a command that never ran because the request was cancelled. */
  private interruptedOutcome(): TerminalRunOutcome {
    return { success: false, output: '', exitCode: null, duration: 0, status: 'interrupted' };
  }

  private async executeOne(
    command: string,
    admitted: AdmittedRequest,
    answers: readonly string[] = [],
  ): Promise<TerminalRunOutcome> {
    if (admitted.signal?.aborted) {
      return this.interruptedOutcome();
    }

    await this.acquireSlot();

    if (admitted.signal?.aborted) {
      this.releaseSlot();

      return this.interruptedOutcome();
    }

    const job: CommandJob = { consumed: 0, truncated: false };
    // The handle is created before the buffer so the limit callback can reach
    // the spawned process once `spawn` returns.
    let spawned: SpawnHandle | undefined;
    const buffer = new StreamBuffer({
      maxBytes: this.policy.maxOutputBytes,
      // A breach kills the tree immediately so a chatty child cannot allocate
      // past the ceiling while the grace period elapses. The dedicated
      // `terminateForLimit` records the stop as `reason: 'limit'`, so the
      // reaped outcome is classified `TERMINAL_OUTPUT_LIMIT` rather than a
      // cancellation.
      onLimitBreached: () => {
        job.truncated = true;
        spawned?.terminateForLimit();
      },
    });

    try {
      spawned = this.manager.spawn({
        command,
        cwd: admitted.cwd,
        env: admitted.env,
        timeoutMs: admitted.timeoutMs,
        graceMs: this.policy.killGraceMs,
        interactive: answers.length > 0,
        onStdout: (chunk) => this.capture(buffer, chunk, 'stdout', job, admitted),
        onStderr: (chunk) => this.capture(buffer, chunk, 'stderr', job, admitted),
        onClose: () => {
          this.releaseSlot();
        },
      });
    } catch (error) {
      // The manager resolves a synchronous `spawn` throw into a synthetic
      // `spawn_error` outcome; this rail covers a manager that throws before
      // returning a handle at all, so the request still becomes a structured
      // `TERMINAL_INTERNAL` decision instead of a rejected promise.
      this.releaseSlot();

      const internal: TerminalRunOutcome & InternalFailureCarrier = {
        success: false,
        output: '',
        exitCode: null,
        duration: 0,
        status: 'failed',
        failure: 'TERMINAL_SPAWN_FAILED',
        internalFailure: error instanceof Error ? error.message : String(error),
      };

      return internal;
    }

    const session: TerminalSessionInfo = sessionInfo(spawned.sessionId, admitted.mode, command, {
      ...(spawned.pid === undefined ? {} : { pid: spawned.pid }),
      ...(admitted.callerId === undefined ? {} : { callerId: admitted.callerId }),
    });
    this.registry.register(session, {
      terminate: spawned.hardTerminate,
      ...(admitted.onChunk === undefined ? {} : { onChunk: admitted.onChunk }),
    });

    if (admitted.signal !== undefined) {
      // Cancellation is immediate: a shell that does not forward `SIGTERM`
      // would otherwise keep its group alive for the whole grace period.
      this.registry.bindSignal(spawned.sessionId, admitted.signal, spawned.hardTerminate);
    }

    this.deliverAnswers(spawned.sessionId, answers, admitted.signal);

    const exit = await spawned.closed;
    this.answerTimers.get(spawned.sessionId)?.();
    this.answerTimers.delete(spawned.sessionId);
    this.registry.remove(spawned.sessionId);
    const drained = buffer.drain();
    const status = this.classify(exit, job);
    const failure = this.outcomeFailureCode(exit, job);
    const outcome: TerminalRunOutcome = {
      success: status === 'success',
      output: drained.output,
      exitCode: exit.exitCode,
      duration: exit.duration,
      status,
      ...(failure === undefined ? {} : { failure }),
    };

    // A run outcome carries no signal field, so the measured signal is kept
    // beside it for the decision that projects this exact outcome.
    this.outcomeSignals.set(outcome, exit.signal);

    return outcome;
  }

  /**
   * Waits for a concurrency slot.
   *
   * The governor bounds actual child processes, so a parallel batch of `N`
   * commands runs at most `concurrency` shells at a time instead of one
   * admission per batch.
   */
  private async acquireSlot(): Promise<void> {
    if (this.activeChildren < this.policy.concurrency) {
      this.activeChildren++;

      return;
    }

    await new Promise<void>((resolve) => {
      this.waiting.push(() => {
        this.activeChildren++;
        resolve();
      });
    });
  }

  /** Frees one concurrency slot and hands it to the oldest waiter. */
  private releaseSlot(): void {
    const next = this.waiting.shift();

    if (next !== undefined) {
      next();

      return;
    }

    this.activeChildren = Math.max(0, this.activeChildren - 1);
  }

  /**
   * Streams answers into a live interactive session on quiescence.
   *
   * Each answer is written once the session has produced no output for
   * {@link ANSWER_QUIESCENCE_MS}, so a prompt that appears later than a fixed
   * delay still receives the next answer, and stdin is closed as soon as the
   * last answer was delivered or the session ended.
   */
  private deliverAnswers(
    sessionId: string,
    answers: readonly string[],
    signal: AbortSignal | undefined,
  ): void {
    if (answers.length === 0) {
      this.manager.finishAnswers(sessionId);

      return;
    }

    let index = 0;
    let timer: NodeJS.Timeout | undefined;
    let finished = false;
    const abortHandler = (): void => {
      finished = true;
      clearTimeout(timer);
    };

    const settle = (): void => {
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortHandler);
      this.manager.finishAnswers(sessionId);
    };

    signal?.addEventListener('abort', abortHandler, { once: true });

    const step = (): void => {
      if (finished) {
        return;
      }

      if (!this.manager.has(sessionId)) {
        settle();

        return;
      }

      const answer = answers[index];
      index++;

      if (answer !== undefined) {
        this.manager.answer(sessionId, `${answer}\n`);
      }

      if (index >= answers.length) {
        settle();

        return;
      }

      timer = setTimeout(step, ANSWER_QUIESCENCE_MS);
      timer.unref();
    };

    timer = setTimeout(step, ANSWER_QUIESCENCE_MS);
    timer.unref();

    this.answerTimers.set(sessionId, () => settle());
  }

  private capture(
    buffer: StreamBuffer,
    chunk: Buffer,
    channel: 'stdout' | 'stderr',
    job: CommandJob,
    admitted: AdmittedRequest,
  ): void {
    const text = chunk.toString('utf8');

    // Retention runs first and unconditionally: a faulty consumer must never
    // cost the transcript that the decision is built from.
    if (!buffer.push(channel, text)) {
      job.truncated = true;
    }

    const consumer = admitted.onChunk;

    if (consumer === undefined) {
      return;
    }

    try {
      consumer(text, admitted.stream.next++, channel);
    } catch (error) {
      // This runs inside a socket `'data'` handler, so an escaping throw would
      // become an uncaught exception and take the host down. The consumer is
      // detached after the first failure: a chunk sink that throws on one
      // chunk would otherwise throw on every later chunk of the session.
      admitted.onChunk = undefined;
      const message = error instanceof Error ? error.message : String(error);
      this.logger?.warn(
        `TerminalService: onChunk consumer threw (${message}); detaching it and continuing to buffer output.`,
      );
    }
  }

  /**
   * Classifies a reaped child.
   *
   * The order is fixed and exhaustive: `spawn_error` → `limit` → `abort` →
   * `timeout` → the exit code itself. The termination reason measured by the
   * process manager decides the first four; a child that merely exited is
   * classified by its own exit code.
   */
  private classify(exit: ManagedExit, job: CommandJob): TerminalStatus {
    switch (exit.reason) {
      case 'spawn_error':
      case 'timeout':
        return 'failed';
      case 'limit':
        return 'failed';
      case 'abort':
        return job.truncated ? 'failed' : 'interrupted';
      case 'exit':
      default:
        break;
    }

    // A truncated transcript is a ceiling breach even when the child exited
    // on its own before the manager could kill it.
    if (job.truncated) {
      return 'failed';
    }

    return exit.exitCode === 0 ? 'success' : 'failed';
  }

  /**
   * Maps a reaped child onto its failure classification, in the same strict
   * order as {@link classify}. Returns `undefined` only for a clean exit.
   */
  private outcomeFailureCode(
    exit: ManagedExit,
    job: CommandJob,
  ): TerminalRunFailure | undefined {
    switch (exit.reason) {
      case 'spawn_error':
        return 'TERMINAL_SPAWN_FAILED';
      case 'limit':
        return 'TERMINAL_OUTPUT_LIMIT';
      case 'abort':
        // A breach that killed the tree is classified as a limit, even though
        // the reaping is observed as a cancellation.
        return job.truncated ? 'TERMINAL_OUTPUT_LIMIT' : 'TERMINAL_INTERRUPTED';
      case 'timeout':
        return 'TERMINAL_TIMEOUT';
      case 'exit':
      default:
        break;
    }

    if (job.truncated) {
      return 'TERMINAL_OUTPUT_LIMIT';
    }

    if (exit.exitCode === 0) {
      return undefined;
    }

    return 'TERMINAL_EXIT_NONZERO';
  }

  /**
   * Converts a measured result into a decision.
   *
   * A failure is never rewrapped as a success: the decision carries the code,
   * the legacy code, the exit status, the terminating signal and the flags a
   * host needs. For a group decision the first terminating result is
   * projected onto the decision fields; the full transcript stays in
   * `result`.
   */
  private decide(outcome: TerminalResult, admitted: AdmittedRequest): TerminalDecision {
    if (isGroupOutcome(outcome)) {
      if (outcome.success) {
        return terminalSuccess(outcome);
      }

      const failing = outcome.results.find((result) => !result.success);

      if (failing !== undefined && isInternalFailure(failing)) {
        return terminalFailure({
          code: 'TERMINAL_INTERNAL',
          legacyCode: 'INTERNAL_ERROR',
          friendly: FRIENDLY_FAILURES.TERMINAL_INTERNAL,
          details: failing.internalFailure,
          actionable: false,
          retryable: true,
          exitCode: null,
          signal: null,
          result: outcome,
          ...(admitted.command.length > 0 ? { command: admitted.command } : {}),
          cwd: admitted.cwd,
        });
      }

      return this.failureDecision(
        failureCodeOf(failing?.failure),
        outcome,
        admitted,
        failing,
      );
    }

    if (outcome.success && outcome.exitCode === 0) {
      return terminalSuccess(outcome);
    }

    if (isInternalFailure(outcome)) {
      // A manager that threw before producing a handle is an internal fault,
      // not a shell-level spawn failure: it is reported as `TERMINAL_INTERNAL`
      // with the thrown text as its diagnostic.
      return terminalFailure({
        code: 'TERMINAL_INTERNAL',
        legacyCode: 'INTERNAL_ERROR',
        friendly: FRIENDLY_FAILURES.TERMINAL_INTERNAL,
        details: outcome.internalFailure,
        actionable: false,
        retryable: true,
        exitCode: null,
        signal: null,
        result: outcome,
        ...(admitted.command.length > 0 ? { command: admitted.command } : {}),
        cwd: admitted.cwd,
      });
    }

    return this.failureDecision(failureCodeOf(outcome.failure), outcome, admitted, outcome);
  }

  /** Builds the failure decision of one outcome or a failing group outcome. */
  private failureDecision(
    code: TerminalErrorCode,
    result: TerminalResult,
    admitted: AdmittedRequest,
    source: TerminalRunOutcome | undefined,
  ): TerminalDecision {
    const exitCode = source?.exitCode ?? null;
    const failure = source?.failure;
    const interrupted = code === 'TERMINAL_INTERRUPTED';

    return terminalFailure({
      code,
      legacyCode: legacyCodeFor(code),
      exitCode,
      // The measured outcome travels with the failure so a host keeps the
      // per-command transcript of a failed batch.
      result,
      actionable: !interrupted,
      retryable: interrupted || code === 'TERMINAL_TIMEOUT',
      friendly: FRIENDLY_FAILURES[code],
      details: failureDetails(code, exitCode, failure),
      ...(admitted.command.length > 0 ? { command: admitted.command } : {}),
      cwd: admitted.cwd,
      signal: this.outcomeSignal(source),
    });
  }

  private invalid(message: string, cwd?: string): TerminalDecision {
    return terminalFailure({
      code: 'TERMINAL_INVALID_REQUEST',
      legacyCode: 'MISSING_FIELD',
      friendly: 'The terminal request is not usable.',
      details: message,
      ...(cwd === undefined ? {} : { cwd }),
      actionable: true,
      retryable: false,
    });
  }

  private interrupted(command: string, cwd?: string): TerminalDecision {
    return terminalFailure({
      code: 'TERMINAL_INTERRUPTED',
      legacyCode: 'TERMINAL_INTERRUPTED',
      friendly: 'The terminal command was interrupted.',
      details: 'The request was cancelled before a process was spawned.',
      command,
      ...(cwd === undefined ? {} : { cwd }),
      actionable: false,
      retryable: true,
    });
  }

  private isAdmitted(value: AdmittedRequest | TerminalDecision): value is AdmittedRequest {
    return !('ok' in value);
  }

  /**
   * Resolves the terminating signal of a failed outcome.
   *
   * An execution outcome carries no signal of its own, so the measured signal
   * is read from the ledger for exactly this outcome; a gate rejection or a
   * request that never spawned has none.
   *
   * @param source - Measured outcome projected onto the failure.
   */
  private outcomeSignal(source: TerminalRunOutcome | undefined): string | null {
    if (source === undefined) {
      return null;
    }

    return this.outcomeSignals.get(source) ?? null;
  }

  private installTerminationHandlers(): void {
    if (typeof process === 'undefined' || typeof process.once !== 'function') {
      return;
    }

    const handler = (): void => {
      this.killAll();
    };

    for (const event of ['exit', 'SIGINT', 'SIGTERM'] as const) {
      process.once(event, handler);
      this.listeners.push({ event, handler });
    }
  }

  private removeTerminationHandlers(): void {
    if (typeof process === 'undefined' || typeof process.removeListener !== 'function') {
      return;
    }

    for (const { event, handler } of this.listeners) {
      process.removeListener(event, handler);
    }

    this.listeners.length = 0;
  }
}

/**
 * Collects every command string from a conditional branch, in order.
 *
 * @param group - Branch to walk.
 * @param into - Accumulator.
 */
function collectGroup(group: TerminalCommandGroup | undefined, into: string[]): void {
  if (group === undefined) {
    return;
  }

  for (const entry of group.commands) {
    if (typeof entry === 'string') {
      into.push(entry);
    } else {
      collectGroup(entry, into);
    }
  }
}

/**
 * Pairs one outcome with its command.
 *
 * @param command - Command text.
 * @param outcome - Measured outcome.
 */
function toExecuted(command: string, outcome: TerminalRunOutcome): TerminalExecutedCommand {
  return {
    command,
    success: outcome.success,
    output: outcome.output,
    exitCode: outcome.exitCode,
    duration: outcome.duration,
    status: outcome.status,
    ...(outcome.failure === undefined ? {} : { failure: outcome.failure }),
  };
}



/**
 * Narrows a run result to its group shape.
 *
 * @param outcome - Result union.
 */
function isGroupOutcome(outcome: TerminalResult): outcome is TerminalGroupOutcome {
  return Array.isArray((outcome as TerminalGroupOutcome).results);
}

/**
 * Narrows an outcome to one that carries a synchronous spawn throw.
 *
 * @param outcome - Measured outcome.
 */
function isInternalFailure(
  outcome: TerminalRunOutcome | TerminalExecutedCommand,
): outcome is (TerminalRunOutcome | TerminalExecutedCommand) & InternalFailureCarrier {
  return typeof (outcome as Partial<InternalFailureCarrier>).internalFailure === 'string';
}

/**
 * Maps the failure classification of an outcome onto its decision code.
 *
 * A failed outcome without a classification can only come from a non-zero
 * exit, so it defaults to `TERMINAL_EXIT_NONZERO`.
 *
 * @param failure - Classification attached to the outcome.
 */
function failureCodeOf(failure: TerminalRunFailure | undefined): TerminalErrorCode {
  switch (failure) {
    case 'TERMINAL_SPAWN_FAILED':
      return 'TERMINAL_SPAWN_FAILED';
    case 'TERMINAL_TIMEOUT':
      return 'TERMINAL_TIMEOUT';
    case 'TERMINAL_OUTPUT_LIMIT':
      return 'TERMINAL_OUTPUT_LIMIT';
    case 'TERMINAL_INTERRUPTED':
      return 'TERMINAL_INTERRUPTED';
    case 'TERMINAL_EXIT_NONZERO':
    default:
      return 'TERMINAL_EXIT_NONZERO';
  }
}

/** Human-readable headline per execution failure code. */
const FRIENDLY_FAILURES: Readonly<Record<TerminalErrorCode, string>> = Object.freeze({
  TERMINAL_UNAVAILABLE: 'Terminal execution unavailable: validation authority not bound.',
  TERMINAL_INVALID_REQUEST: 'The terminal request is not usable.',
  TERMINAL_BLOCKED: 'The command was refused by the validation gate.',
  TERMINAL_SPAWN_FAILED: 'The terminal process could not be started.',
  TERMINAL_EXIT_NONZERO: 'The terminal command exited with a non-zero status.',
  TERMINAL_TIMEOUT: 'The terminal command exceeded its timeout.',
  TERMINAL_INTERRUPTED: 'The terminal command was interrupted.',
  TERMINAL_OUTPUT_LIMIT: 'The terminal command exceeded the output ceiling and was stopped.',
  TERMINAL_INTERNAL: 'The terminal service failed internally.',
});

/**
 * Builds the diagnostic text of an execution failure.
 *
 * @param code - Kernel failure code.
 * @param exitCode - Exit status, when the process reported one.
 * @param failure - Classification attached to the outcome.
 */
function failureDetails(
  code: TerminalErrorCode,
  exitCode: number | null,
  failure: TerminalRunFailure | undefined,
): string {
  const classified = failure === undefined ? '' : ` (${failure})`;

  switch (code) {
    case 'TERMINAL_SPAWN_FAILED':
      return `The process could not be spawned${classified}.`;
    case 'TERMINAL_INTERNAL':
      return `The terminal service failed internally while starting the process${classified}.`;
    case 'TERMINAL_TIMEOUT':
      return `The process was killed after exceeding its timeout${classified}.`;
    case 'TERMINAL_OUTPUT_LIMIT':
      return `The process was stopped after its output exceeded the configured ceiling${classified}.`;
    case 'TERMINAL_INTERRUPTED':
      return `The process was terminated before it exited on its own${classified}.`;
    case 'TERMINAL_EXIT_NONZERO':
      return exitCode === null
        ? `The process ended without a usable exit status${classified}.`
        : `The process exited with status ${exitCode}${classified}.`;
    default:
      return `The terminal request failed${classified}.`;
  }
}
