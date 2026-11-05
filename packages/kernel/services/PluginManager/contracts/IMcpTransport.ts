/**
 * Host-provided MCP transport handed to a plugin after activation.
 *
 * This contract is intentionally MCP-specific. It is not a generic transport
 * registry: it carries exactly the operations an MCP server plugin needs so
 * the daemon can own the listener and the plugin can stay a leaf package.
 * A generic transport API is deferred to Phase 10.B.
 */
export interface IMcpTransport {
  /** Transport family. */
  readonly kind: 'stdio' | 'mcp-http';

  /**
   * Bound URL for `mcp-http` transports.
   *
   * Absent for `stdio`, which uses the daemon's process streams.
   */
  readonly address?: string;

  /**
   * Registers the handler that receives decoded MCP messages.
   *
   * The transport forwards each message in arrival order and writes whatever
   * the handler resolves to the corresponding response channel. A handler
   * result of `undefined` means "no response" (a JSON-RPC notification).
   *
   * @param handler - Decoder sink supplied by the plugin.
   */
  onMessage(handler: (msg: unknown) => Promise<unknown>): void;

  /**
   * Sends a server-to-client MCP notification.
   *
   * @param msg - Notification payload, already shaped as JSON.
   */
  sendNotification(msg: unknown): void;

  /** Stops accepting messages and releases the underlying listener. */
  close(): Promise<void>;
}