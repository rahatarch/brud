import type { IBrudPlugin, IMcpTransport, IPluginContext } from '@brud/service-plugin-manager';
import { manifest } from './manifest.js';
import { createMcpServer } from './server/mcpServer.js';
import { ImcpTransportBridge } from './server/transportBridge.js';

/**
 * Builds the MCP bridge plugin.
 *
 * Activation is intentionally inert: the plugin declares transports, not
 * tools, and waits for the host to bind one. `onTransportAttach` constructs an
 * MCP SDK server, adapts the daemon's {@link IMcpTransport} to the SDK
 * `Transport` contract, and connects them.
 */
export function createMcpBridgePlugin(): IBrudPlugin {
  let context: IPluginContext | undefined;

  return {
    manifest,

    activate(pluginContext: IPluginContext): void {
      context = pluginContext;
    },

    async onTransportAttach(transport: IMcpTransport): Promise<void> {
      if (context === undefined) {
        throw new Error('MCP bridge received a transport before activation');
      }

      const server = createMcpServer(context);
      const bridge = new ImcpTransportBridge(transport, { logger: context.logger });

      context.subscriptions.add({
        dispose: async (): Promise<void> => {
          await server.close();
        },
      });

      await server.connect(bridge);

      context.logger.info('MCP transport attached', { kind: transport.kind });
    },
  };
}

/** Shared MCP bridge plugin instance. */
export const plugin: IBrudPlugin = createMcpBridgePlugin();

export default plugin;