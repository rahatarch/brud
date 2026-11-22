/**
 * Throwaway participant for kernel tests. It claims one operation kind and
 * answers a few fixed operations. It knows nothing about any Foundation
 * service: the kernel must host it exactly as it would host any participant.
 */
import {
  createServiceToken,
  withExposureBindings,
  type KernelServiceModuleContext,
  type OperationResult,
  type ServiceDescriptor,
} from '../../../index.js';

export interface ProbeSpec {
  /** The operation kind this participant claims. */
  readonly kind: string;
}

interface ProbeOperation {
  readonly name: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

interface ProbeContext {
  readonly caller: { readonly capabilities: readonly string[]; readonly origin: string };
  readonly signal?: AbortSignal;
  readonly dryRun?: boolean;
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<'done' | 'aborted'> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve('aborted');
      return;
    }

    const timer = setTimeout(() => resolve('done'), ms);

    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve('aborted');
    }, { once: true });
  });
}

/**
 * Builds the descriptor of a participant that owns `spec.kind`.
 *
 * Operations: `echo` (returns its parameters and the kernel-derived caller),
 * `fail` (typed failure), `throw` (throws), `sleep` (honours cancellation),
 * `invalid` (returns a result of the wrong shape), `skip` (reports skipped).
 */
export function createProbeDescriptor(
  context: KernelServiceModuleContext,
  spec: ProbeSpec,
): ServiceDescriptor<{ readonly kind: string }> {
  void context;

  const token = createServiceToken<{ readonly kind: string }>(`acme.probe.${spec.kind}`, `Kernel test probe (${spec.kind})`);
  const exposure = `acme.probe.${spec.kind}.dispatch`;

  return {
    token,
    tier: 'userland',
    dependencies: [],
    manifest: {
      requests: { capabilities: [] },
      exposures: [{ name: exposure, version: 1, scope: 'any', policy: { policyVersion: 2, official: true } }],
      kinds: [{
        kind: spec.kind,
        exposure,
        description: `Kernel test probe (${spec.kind})`,
        permission: { policyVersion: 2 },
        operations: {
          echo: { description: 'Echo parameters', input: { type: 'object' } },
          fail: { description: 'Always fails' },
          throw: { description: 'Always throws' },
          sleep: { description: 'Waits, honouring cancellation' },
          invalid: { description: 'Returns a result of the wrong shape' },
          skip: { description: 'Reports skipped' },
        },
      }],
      events: [],
    },
    factory: () => withExposureBindings({ kind: spec.kind }, {
      [`${exposure}@1`]: {
        projection: () => ({
          dispatch: async (operation: ProbeOperation, dispatchContext: ProbeContext): Promise<unknown> => {
            switch (operation.name) {
              case 'echo':
                return {
                  status: 'success',
                  data: {
                    parameters: operation.parameters,
                    capabilities: [...dispatchContext.caller.capabilities],
                    origin: dispatchContext.caller.origin,
                    dryRun: dispatchContext.dryRun === true,
                  },
                } satisfies OperationResult;
              case 'fail':
                return { status: 'failed', error: 'probe failed on purpose' } satisfies OperationResult;
              case 'throw':
                throw new Error('probe threw on purpose');
              case 'sleep': {
                const outcome = await sleep(Number(operation.parameters.ms ?? 1000), dispatchContext.signal);

                return outcome === 'aborted'
                  ? ({ status: 'aborted', message: 'cancelled' } satisfies OperationResult)
                  : ({ status: 'success', data: { slept: true } } satisfies OperationResult);
              }
              case 'invalid':
                return { status: 'bogus' };
              case 'skip':
                return { status: 'skipped', message: 'nothing to do' } satisfies OperationResult;
              default:
                return { status: 'failed', error: `probe cannot ${operation.name}` } satisfies OperationResult;
            }
          },
        }),
      },
    }),
  } as unknown as ServiceDescriptor<{ readonly kind: string }>;
}
