export interface McpClientConfig {
  readonly mcpServers: { readonly brud: { readonly url: string } };
}

export function buildMcpClientConfig(endpoint: string): McpClientConfig {
  return { mcpServers: { brud: { url: endpoint } } };
}

export function serializeMcpClientConfig(endpoint: string): string {
  return JSON.stringify(buildMcpClientConfig(endpoint), null, 2);
}
