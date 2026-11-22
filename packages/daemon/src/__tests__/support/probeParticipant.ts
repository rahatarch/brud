/**
 * Throwaway participant for daemon tests. It owns the `probe` kind and knows
 * nothing about any Foundation service: the daemon must host it exactly as it
 * would host any participant.
 */
import type {
  KernelServiceModuleContext,
  OperationResult,
  ServiceContext,
  ServiceDescriptor,
} from '@brud/kernel' with { 'resolution-mode': 'import' };

interface ProbeOperation {
  readonly name: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

interface ProbeContext {
  readonly caller: { readonly capabilities: readonly string[]; readonly origin: string };
  readonly signal?: AbortSignal;
}

interface Probe {
  readonly label: string;
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

export async function createService(context: KernelServiceModuleContext): Promise<ServiceDescriptor<Probe>> {
  const { createServiceToken, withExposureBindings } = await import('@brud/kernel');
  const ProbeToken = createServiceToken<Probe>('acme.probe', 'Daemon test probe');

  context.declareContextFields('probe', [
    { name: 'probe.label', type: 'string', required: true, description: 'Label echoed by the probe.' },
  ]);

  return {
    token: ProbeToken,
    tier: 'userland',
    dependencies: [],
    manifest: {
      requests: { capabilities: [] },
      exposures: [{ name: 'acme.probe.dispatch', version: 1, scope: 'any', policy: { policyVersion: 2, official: true } }],
      kinds: [{
        kind: 'probe',
        exposure: 'acme.probe.dispatch',
        description: 'Daemon test probe',
        permission: { policyVersion: 2 },
        operations: {
          echo: { description: 'Echo parameters', input: { type: 'object' } },
          sleep: { description: 'Wait, honouring cancellation' },
          fail: { description: 'Always fails' },
        },
      }],
      events: [],
    },
    factory: (serviceContext: ServiceContext) => {
      const label = String(serviceContext.options['probe.label']);
      const instance: Probe = { label };

      return withExposureBindings(instance, {
        'acme.probe.dispatch@1': {
          projection: () => ({
            dispatch: async (operation: ProbeOperation, dispatchContext: ProbeContext): Promise<OperationResult> => {
              if (operation.name === 'echo') {
                return {
                  status: 'success',
                  data: {
                    label,
                    parameters: operation.parameters,
                    capabilities: [...dispatchContext.caller.capabilities],
                    origin: dispatchContext.caller.origin,
                  },
                };
              }

              if (operation.name === 'sleep') {
                const outcome = await sleep(Number(operation.parameters.ms ?? 1000), dispatchContext.signal);

                return outcome === 'aborted'
                  ? { status: 'aborted', message: 'cancelled' }
                  : { status: 'success', data: { slept: true } };
              }

              return { status: 'failed', error: `probe cannot ${operation.name}` };
            },
          }),
        },
      });
    },
  } as unknown as ServiceDescriptor<Probe>;
}
