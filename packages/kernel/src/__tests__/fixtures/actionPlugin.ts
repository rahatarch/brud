import type { OperationResult } from '../../contracts/handler.js';
import type { IBrudPlugin } from '../../../services/PluginManager/contracts/IBrudPlugin.js';
import type { IPluginContext } from '../../../services/PluginManager/contracts/IPluginContext.js';
import type { PluginPermission } from '../../../services/PluginManager/contracts/permissions.js';

/** Stable plugin id used by the end-to-end action pipeline test. */
export const ECHO_ACTION_PLUGIN_ID = 'acme.test.echo-ui';

/** Action name the fixture registers. */
export const ECHO_ACTION_NAME = 'echo_ui';

/**
 * Builds a test plugin that registers one UI-only action.
 *
 * The schema requires `message` so the test can prove the ActionManager schema
 * gate runs before the handler.
 */
export function createEchoActionPlugin(): IBrudPlugin {
  return {
    manifest: {
      id: ECHO_ACTION_PLUGIN_ID,
      name: 'Echo UI Action',
      version: '1.0.0',
      permissions: ['actions:register'],
    },
    activate(context: IPluginContext): void {
      context.registerAction({
        name: ECHO_ACTION_NAME,
        description: 'Echoes a message back to the UI',
        parametersSchema: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
          required: ['message'],
        },
        execute: async (input, executionContext): Promise<OperationResult> => ({
          status: 'success',
          data: {
            message: input.message,
            pluginId: ECHO_ACTION_PLUGIN_ID,
            callerId: executionContext.callerId,
            workspaceRoot: executionContext.workspaceRoot,
            origin: executionContext.origin,
          },
        }),
      });
    },
  };
}

/** Observations recorded by {@link createActionProbePlugin}. */
export interface ActionBoundaryProbe {
  /** Error thrown by `context.registerAction`, when one was attempted. */
  registerError?: unknown;

  /** Whether the context leaked `executeAction`. */
  executeActionExposed?: boolean;

  /** Whether the context leaked `getActionManager`. */
  getActionManagerExposed?: boolean;

  /** Whether the context leaked `listActions`. */
  listActionsExposed?: boolean;
}

/**
 * Builds a plugin that probes the plugin-facing action surface.
 *
 * It always attempts registration and records the rejection. With no
 * `actions:register` permission the manager must throw `PluginPermissionError`;
 * with the permission the probe simply proves the call succeeded.
 */
export function createActionProbePlugin(
  id: string,
  permissions: readonly PluginPermission[],
  probe: ActionBoundaryProbe,
): IBrudPlugin {
  return {
    manifest: {
      id,
      name: 'Action Boundary Probe',
      version: '1.0.0',
      permissions: [...permissions],
    },
    activate(context: IPluginContext): void {
      const exposed = context as unknown as Record<string, unknown>;

      probe.executeActionExposed = typeof exposed.executeAction === 'function';
      probe.getActionManagerExposed = typeof exposed.getActionManager === 'function';
      probe.listActionsExposed = typeof exposed.listActions === 'function';

      try {
        context.registerAction({
          name: `${id}_probe`,
          description: 'Probe action',
          parametersSchema: { type: 'object' },
          execute: async (): Promise<OperationResult> => ({ status: 'success' }),
        });
      } catch (error: unknown) {
        probe.registerError = error;
      }
    },
  };
}