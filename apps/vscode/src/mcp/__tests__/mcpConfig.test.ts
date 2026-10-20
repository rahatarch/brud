import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildMcpClientConfig, serializeMcpClientConfig } from '../mcpConfig';

describe('MCP client configuration', () => {
  it('produces a single-server configuration with the live endpoint', () => {
    const config = buildMcpClientConfig('http://127.0.0.1:7717/mcp');
    assert.deepStrictEqual(config, {
      mcpServers: { brud: { url: 'http://127.0.0.1:7717/mcp' } },
    });
  });

  it('serializes to valid JSON that round-trips', () => {
    const text = serializeMcpClientConfig('http://127.0.0.1:4000/mcp');
    const parsed = JSON.parse(text) as ReturnType<typeof buildMcpClientConfig>;
    assert.strictEqual(parsed.mcpServers.brud.url, 'http://127.0.0.1:4000/mcp');
    assert.ok(text.includes('\n'), 'configuration should be human-readable');
  });

  it('does not invent credentials or headers', () => {
    const text = serializeMcpClientConfig('http://127.0.0.1:4000/mcp');
    assert.ok(!text.includes('headers'));
    assert.ok(!text.includes('token'));
  });
});
