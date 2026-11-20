import type { ServiceDescriptor, ServiceTier } from '@brud/kernel';
import { defineParticipant } from '@brud/sdk/participant';
import type { IBrudToolsService } from '../contracts/IBrudToolsService.js';
import { BRUD_TOOLS_DISPATCH_EXPOSURE, BRUD_TOOLS_EXPOSURE, SETTINGS_READER_EXPOSURE } from '../contracts/exposure.js';
import type { BrudDispatchContext } from '@brud/kernel/services/Router/contracts/types.js';
import type { BrudOperation } from '@brud/kernel/services/Parser/contracts/types.js';
import { BrudToolsService, type IToolsLogger } from '../orchestrator/index.js';
import { BrudToolsToken } from './tokens.js';
import { toolsHandle } from './toolsExposure.js';

/** Tier assigned to the BrudTools descriptor. */
export const BRUD_TOOLS_SERVICE_TIER: ServiceTier = 'core';

/** Options for {@link createBrudToolsDescriptor}. */
export interface BrudToolsDescriptorOptions {
  /** Receives non-fatal warnings. */
  readonly logger?: IToolsLogger;
}

/** The slice of the settings exposure BrudTools reads. */
interface SettingsReaderView {
  getSnapshot(): { readonly toolAllowList?: Readonly<Record<string, boolean>> };
}

/**
 * Builds the BrudTools descriptor with the BrudOS SDK: one exposure,
 * `brud.tools@1`, shaped by the caller's capabilities; the tool allow-list is
 * read by resolving `brud.settings.reader` as BrudTools (unresolved → every
 * tool allowed).
 *
 * @param options - Descriptor options.
 * @returns The descriptor.
 */
export function createBrudToolsDescriptor(
  options?: BrudToolsDescriptorOptions,
): ServiceDescriptor<IBrudToolsService, BrudToolsService> {
  return defineParticipant<BrudToolsService>({
    id: BrudToolsToken.id,
    description: 'Live tool registry, certification status, schema gate and dispatch table',
    tier: BRUD_TOOLS_SERVICE_TIER,
    exposes: {
      [BRUD_TOOLS_EXPOSURE]: { version: 1, scope: 'runtime', handle: toolsHandle },
      // Official callers only (the Router is one): it trusts the caller view in
      // its context, which non-official (caged) code can never supply.
      [BRUD_TOOLS_DISPATCH_EXPOSURE]: {
        version: 1,
        scope: 'any',
        policy: { policyVersion: 2, official: true },
        handle: (_caller, ctx) => ({ dispatch: (operation: BrudOperation, context: BrudDispatchContext) => ctx.instance.dispatchRouted(operation, context) }),
      },
    },
    create: (ctx) => new BrudToolsService({
      resolveToolExposure: (name, version, owner) => ctx.resolve(name, {
        version,
        ...(owner === undefined ? {} : { expectedOwner: owner }),
      }),
      ...(options?.logger === undefined ? {} : { logger: options.logger }),
      getToolAllowList: () =>
        ctx.resolve<SettingsReaderView>(SETTINGS_READER_EXPOSURE)?.getSnapshot().toolAllowList ?? {},
    }),
  })() as unknown as ServiceDescriptor<IBrudToolsService, BrudToolsService>;
}
