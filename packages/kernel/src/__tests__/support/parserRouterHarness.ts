import type { IKernelAccessBroker, ServiceInfo } from '../../contracts/accessBroker.js';
import type { OperationResult } from '../../contracts/handler.js';
import type { IBrudKernel } from '../../contracts/kernel.js';
import type { ServiceContext } from '../../contracts/lifecycle.js';
import type { ServiceToken } from '../../contracts/serviceToken.js';
import type {
  BrudOperation,
  BrudParseFailure,
  BrudParseOptions,
  BrudParseResult,
  IBrudParserService,
} from '../../../services/Parser/contracts/index.js';
import { ParserService } from '../../../services/Parser/orchestrator/index.js';
import { ParserToken } from '../../../services/Parser/descriptor/tokens.js';
import type {
  IBrudToolsService,
  IPluginExecutionContext,
  ToolRegistrationOptions,
} from '../../../services/BrudTools/contracts/IBrudToolsService.js';
import { BrudToolsService } from '../../../services/BrudTools/orchestrator/index.js';
import { BrudToolsToken } from '../../../services/BrudTools/descriptor/tokens.js';
import { ROUTER_CALLER_ID } from '../../../services/Router/contracts/caller.js';
import type {
  BrudRouteResult,
  RoutedOperationOutcome,
} from '../../../services/Router/contracts/types.js';
import { RouterService } from '../../../services/Router/orchestrator/index.js';
import { RouterToken } from '../../../services/Router/descriptor/tokens.js';

/** Tool-shaped parsed operation used by the historical parser suites. */
export interface ToolShapedParsedOperation {
  readonly index: string;
  readonly kind: string;
  readonly name: string;
  readonly toolName: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

/** Tool-shaped parse result. */
export type ToolShapedParseResult =
  | { readonly ok: true; readonly operations: readonly ToolShapedParsedOperation[] }
  | { readonly ok: false; readonly error: BrudParseFailure };

/** Tool-shaped routed outcome. */
export interface ToolShapedRoutedOutcome {
  readonly operationIndex: string;
  readonly sequence: number;
  readonly toolName: string;
  readonly status: string;
  readonly result?: OperationResult;
  readonly error?: string;
}

/** Tool-shaped route result. */
export interface ToolShapedRouteResult {
  readonly status: 'success' | 'partial' | 'failed' | 'empty';
  readonly operations: readonly ToolShapedRoutedOutcome[];
  readonly parseError?: BrudParseFailure;
  readonly dispatched: number;
  readonly failed: number;
}

/** Options accepted by {@link ParserRouterHarness.parseAndRoute}. */
export interface ToolShapedRouteOptions {
  readonly callerContext?: IPluginExecutionContext;
  readonly stopOnFailure?: boolean;
  readonly dryRun?: boolean;
  readonly maxOperations?: number;
}

/**
 * Test-only adapter that exposes the historical `parseInput`/`parseAndRoute`
 * shape over the new Parser + Router + BrudTools composition.
 *
 * Production code no longer has these methods on BrudTools; the harness lets
 * the existing adversarial suites keep their assertions while exercising the
 * real Parser, the real Router, and the real tool registry.
 */
export class ParserRouterHarness {
  private readonly toolsService: IBrudToolsService;

  private readonly parserService: IBrudParserService;

  private readonly routerService: {
    route(rawInput: string, options?: ToolShapedRouteOptions): Promise<BrudRouteResult>;
  };

  constructor(services?: {
    readonly tools: IBrudToolsService;
    readonly parser: IBrudParserService;
    readonly router: {
      route(rawInput: string, options?: ToolShapedRouteOptions): Promise<BrudRouteResult>;
    };
  }) {
    if (services !== undefined) {
      this.toolsService = services.tools;
      this.parserService = services.parser;
      this.routerService = services.router;

      return;
    }

    const tools = new BrudToolsService();
    const parser = new ParserService();
    const broker = new StandaloneBroker(new Map<string, unknown>([
      [BrudToolsToken.id, tools],
      [ParserToken.id, parser],
    ]));
    const router = new RouterService({
      broker,
      callerContext: {
        callerId: ROUTER_CALLER_ID,
        tier: 'core',
        options: { workspaceRoot: '' },
      },
      getParser: () => parser,
    });

    tools.registerWithRouter(router);
    router.closeRegistration();

    this.toolsService = tools;
    this.parserService = parser;
    this.routerService = router;
  }

  /** Resolves the three services from an already-booted kernel. */
  static fromKernel(kernel: IBrudKernel, root: string): ParserRouterHarness {
    const caller: ServiceContext = {
      callerId: 'kernel',
      tier: 'core',
      options: { workspaceRoot: root },
    };

    return new ParserRouterHarness({
      tools: kernel.requestAccess<IBrudToolsService>(caller, BrudToolsToken),
      parser: kernel.requestAccess<IBrudParserService>(caller, ParserToken),
      router: kernel.requestAccess<{ route: RouterHarnessRoute }>(caller, RouterToken),
    });
  }

  registerTool(
    pluginId: string,
    isOfficial: boolean,
    options: ToolRegistrationOptions,
  ): unknown {
    return this.toolsService.registerTool(pluginId, isOfficial, options);
  }

  parseInput(rawInput: string, options?: Pick<BrudParseOptions, 'maxOperations'>): ToolShapedParseResult {
    const parsed = this.parserService.parse(rawInput, options);

    return adaptParseResult(parsed);
  }

  async parseAndRoute(
    rawInput: string,
    options: ToolShapedRouteOptions = {},
  ): Promise<ToolShapedRouteResult> {
    const caller = options.callerContext;
    const routed = await this.routerService.route(rawInput, {
      ...(caller?.callerId === undefined ? {} : { callerId: caller.callerId }),
      ...(caller?.workspaceRoot === undefined ? {} : { workspaceRoot: caller.workspaceRoot }),
      ...(caller?.permissions === undefined ? {} : { permissions: caller.permissions }),
      ...(caller?.signal === undefined ? {} : { signal: caller.signal }),
      ...(caller?.origin === undefined ? {} : { origin: caller.origin }),
      ...(options.stopOnFailure === undefined ? {} : { stopOnFailure: options.stopOnFailure }),
      ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
      ...(options.maxOperations === undefined ? {} : { maxOperations: options.maxOperations }),
    });

    return adaptRouteResult(routed, options.dryRun === true);
  }
}

/** Route shape the harness needs from the Router service. */
type RouterHarnessRoute = (
  rawInput: string,
  options?: ToolShapedRouteOptions,
) => Promise<BrudRouteResult>;

/** Minimal broker for standalone harness construction. */
class StandaloneBroker implements IKernelAccessBroker {
  private readonly services: Map<string, unknown>;

  constructor(services: Map<string, unknown>) {
    this.services = services;
  }

  requestAccess<TService>(caller: ServiceContext, token: ServiceToken<TService>): TService {
    void caller;

    const service = this.services.get(token.id);

    if (service === undefined) {
      throw new Error(`Service "${token.id}" is not registered`);
    }

    return service as TService;
  }

  hasService(token: ServiceToken<unknown>): boolean {
    return this.services.has(token.id);
  }

  listServices(): readonly ServiceInfo[] {
    return Object.freeze([]);
  }
}

/** Adds the tool-shaped `toolName` alias to parsed operations. */
function adaptParseResult(parsed: BrudParseResult): ToolShapedParseResult {
  if (!parsed.ok) {
    return parsed;
  }

  return {
    ok: true,
    operations: Object.freeze(parsed.operations.map((operation: BrudOperation) => ({
      index: operation.index,
      kind: operation.kind,
      name: operation.name,
      toolName: operation.name,
      parameters: operation.parameters,
    }))),
  };
}

/** Maps Router outcomes back to the historical tool-shaped result. */
function adaptRouteResult(
  routed: BrudRouteResult,
  dryRun: boolean,
): ToolShapedRouteResult {
  const operations: ToolShapedRoutedOutcome[] = routed.operations.map(
    (outcome: RoutedOperationOutcome) => ({
      operationIndex: outcome.operationIndex,
      sequence: outcome.sequence,
      toolName: outcome.name,
      status: toolShapedStatus(outcome),
      ...(outcome.result === undefined ? {} : { result: outcome.result }),
      ...(outcome.error === undefined && resultError(outcome.result) === undefined
        ? {}
        : { error: outcome.error ?? resultError(outcome.result) }),
    }),
  );

  let dispatched = 0;
  let failed = 0;

  for (const outcome of operations) {
    if (
      !dryRun
      && (outcome.status === 'success' || outcome.status === 'failed')
    ) {
      dispatched += 1;
    }

    if (
      outcome.status !== 'success'
      && outcome.status !== 'skipped'
      && outcome.status !== 'aborted'
    ) {
      failed += 1;
    }
  }

  return {
    status: routed.parseError === undefined ? aggregate(operations) : 'failed',
    operations: Object.freeze(operations),
    ...(routed.parseError === undefined ? {} : { parseError: routed.parseError }),
    dispatched,
    failed,
  };
}

/** Extracts a string error from an operation result. */
function resultError(result: OperationResult | undefined): string | undefined {
  if (result === undefined) {
    return undefined;
  }

  if (typeof result.error === 'string') {
    return result.error;
  }

  return result.error instanceof Error ? result.error.message : undefined;
}

/** Reclassifies a failed tool result with its stable code. */
function toolShapedStatus(outcome: RoutedOperationOutcome): string {
  if (outcome.status !== 'failed') {
    return outcome.status;
  }

  const message = String(outcome.result?.error ?? outcome.error ?? '');

  if (/^TOOL_NOT_FOUND:/.test(message)) {
    return 'tool_not_found';
  }

  if (/^(SCHEMA_INVALID|TOOL_VALIDATION_ERROR):/.test(message)) {
    return 'schema_invalid';
  }

  return outcome.status;
}

/** Tool-shaped aggregate status. */
function aggregate(
  outcomes: readonly ToolShapedRoutedOutcome[],
): ToolShapedRouteResult['status'] {
  if (outcomes.length === 0) {
    return 'empty';
  }

  const successes = outcomes.filter((outcome) => outcome.status === 'success').length;

  if (successes === outcomes.length) {
    return 'success';
  }

  if (successes === 0) {
    return 'failed';
  }

  return 'partial';
}