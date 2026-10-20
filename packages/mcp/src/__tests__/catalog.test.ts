import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getToolCatalog } from '../catalog';
import { getToolParameterNames } from '../normalize';

describe('MCP tool catalog', () => {
  it('publishes one tool per documented registry entry', () => {
    const catalog = getToolCatalog();
    assert.strictEqual(catalog.excluded.length, 0, JSON.stringify(catalog.excluded));
    assert.strictEqual(catalog.tools.length, 20);
    const names = catalog.tools.map((tool) => tool.name);
    assert.strictEqual(new Set(names).size, names.length, 'tool names must be unique');
    for (const name of names) {
      assert.match(name, /^[a-zA-Z0-9_-]{1,64}$/);
    }
  });

  it('accepts exactly the parameters the translator accepts', () => {
    const catalog = getToolCatalog();
    for (const tool of catalog.tools) {
      const accepted = getToolParameterNames(tool.name);
      assert.ok(accepted, `no translator spec for catalog tool ${tool.name}`);
      const schemaKeys = Object.keys(tool.inputSchema.properties).sort();
      assert.deepStrictEqual(schemaKeys, [...accepted].sort(), `schema/translator mismatch for ${tool.name}`);
    }
  });

  it('marks required parameters from the registry', () => {
    const catalog = getToolCatalog();
    const byName = new Map(catalog.tools.map((tool) => [tool.name, tool]));
    assert.deepStrictEqual(byName.get('read_file')?.inputSchema.required, ['filePath']);
    assert.deepStrictEqual(byName.get('create_file')?.inputSchema.required.sort(), ['content', 'path']);
    assert.deepStrictEqual(byName.get('codebase_metadata')?.inputSchema.required, []);
    assert.deepStrictEqual(byName.get('codebase_metadata')?.inputSchema.properties, {});
  });

  it('rejects undeclared arguments at the schema level', () => {
    const catalog = getToolCatalog();
    for (const tool of catalog.tools) {
      assert.strictEqual(tool.inputSchema.additionalProperties, false);
      assert.strictEqual(tool.inputSchema.type, 'object');
    }
  });

  it('maps registry types to JSON schema types with usable defaults', () => {
    const catalog = getToolCatalog();
    const byName = new Map(catalog.tools.map((tool) => [tool.name, tool]));
    const readFile = byName.get('read_file');
    assert.strictEqual(readFile?.inputSchema.properties.filePath.type, 'string');
    assert.strictEqual(readFile?.inputSchema.properties.isImportRead.type, 'boolean');
    assert.strictEqual(readFile?.inputSchema.properties.maxDepth.type, 'number');
    const depth = byName.get('extract_structure')?.inputSchema.properties.depth;
    assert.strictEqual(depth?.type, 'number');
    assert.strictEqual(depth?.default, 0);
    const files = byName.get('create_directory')?.inputSchema.properties.files;
    assert.strictEqual(files?.type, 'array');
    assert.deepStrictEqual(files?.items, { type: 'string' });
  });

  it('does not leak protocol boilerplate into descriptions', () => {
    const catalog = getToolCatalog();
    for (const tool of catalog.tools) {
      assert.ok(tool.description.length > 0);
      assert.ok(!tool.description.includes('CRITICAL PROTOCOL'), `${tool.name} leaks boilerplate`);
      assert.ok(tool.description.startsWith(tool.name) || tool.description.length > 10);
    }
  });
});
