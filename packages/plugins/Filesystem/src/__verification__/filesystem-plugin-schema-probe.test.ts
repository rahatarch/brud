/**
 * Goal 1 — Schema conformance, independently probed against the live registry.
 *
 * The schemas are read from BrudTools.getTool(name), not from the plugin's own
 * exported constants, so a registration regression cannot hide behind the
 * implementation's source.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPECTED_SCHEMAS,
  FILESYSTEM_PLUGIN_ID,
  TOOL_NAMES,
  acquireVerificationLock,
  bootVerificationKernel,
  releaseVerificationLock,
} from './support/harness.test.js';
import type { ToolName, VerificationKernel } from './support/harness.test.js';

const EXPECTED_DESCRIPTIONS: Readonly<Record<ToolName, string>> = Object.freeze({
  create_file: 'Create a new file with specified content',
  delete_file: 'Remove a file from the filesystem',
  rename_file: 'Rename a file from one name to another',
  move_file: 'Move a file from one location to another',
  copy_file: 'Copy a file from one location to another',
  append_file: 'Append content to the end of an existing file',
  create_directory: 'Create a new directory with optional empty files',
  delete_directory: 'Remove a directory and all its contents',
  move_directory: 'Move a directory from one location to another',
  append_file_multi: 'Append content to multiple files matching a pattern',
  search_replace: 'Search for existing content and replace it with new content',
  search_replace_multi: 'Search and replace text across multiple files',
});

let kernel: VerificationKernel;

before(async () => {
  await acquireVerificationLock();
  kernel = await bootVerificationKernel({ prefix: 'brud-fs-verify-schema-' });
});

after(async () => {
  await kernel.shutdown();
  await releaseVerificationLock();
});

function filesystemTools(): ReturnType<VerificationKernel['tools']['listTools']> {
  return kernel.tools
    .listTools()
    .filter((tool) => tool.ownerPluginId === FILESYSTEM_PLUGIN_ID);
}

describe('Goal 1 — live schema conformance', () => {
  it('registers exactly the twelve audited tools and no alias names', () => {
    const registered = filesystemTools().map((tool) => tool.name).sort();

    assert.deepEqual(registered, [...TOOL_NAMES].sort());
  });

  it('does not expose any filesystem tool under an alias', () => {
    for (const tool of filesystemTools()) {
      assert.ok(
        (TOOL_NAMES as readonly string[]).includes(tool.name),
        `unexpected filesystem tool name: ${tool.name}`,
      );
    }
  });

  for (const name of TOOL_NAMES) {
    const expected = EXPECTED_SCHEMAS[name];

    it(`${name} has the exact live discovery schema`, () => {
      const tool = kernel.tools.getTool(name);

      assert.ok(tool, `${name} must be registered in the live registry`);
      assert.equal(tool.ownerPluginId, FILESYSTEM_PLUGIN_ID);
      assert.equal(tool.description, EXPECTED_DESCRIPTIONS[name]);

      const schema = tool.parametersSchema;

      assert.equal(schema.type, 'object');
      assert.equal(schema.additionalProperties, false);

      const properties = schema.properties as Record<string, unknown>;

      assert.ok(properties, `${name}.properties must exist`);
      assert.deepEqual(
        Object.keys(properties).sort(),
        [...expected.properties].sort(),
        `${name} property surface`,
      );
      assert.deepEqual(
        [...(schema.required as string[])].sort(),
        [...expected.required].sort(),
        `${name} required surface`,
      );

      assert.equal('index' in properties, false, `${name} must not expose index`);
      assert.equal(
        (schema.required as string[]).includes('index'),
        false,
        `${name} must not require index`,
      );
      assert.equal(
        JSON.stringify(schema).includes('"index"'),
        false,
        `${name} must not mention index anywhere`,
      );

      for (const property of expected.properties) {
        assert.ok(property in properties, `${name}.${property} must be declared`);
      }
    });
  }

  it('declares the append enum and default exactly at the audit values', () => {
    const append = kernel.tools.getTool('append_file');
    const multi = kernel.tools.getTool('append_file_multi');

    assert.ok(append && multi);

    const appendProperties = append.parametersSchema.properties as Record<
      string,
      Record<string, unknown>
    >;
    const multiProperties = multi.parametersSchema.properties as Record<
      string,
      Record<string, unknown>
    >;

    assert.deepEqual(appendProperties.position?.enum, ['start', 'end']);
    assert.equal(appendProperties.position?.default, 'end');
    assert.deepEqual(multiProperties.position?.enum, ['start', 'end']);
    assert.equal(multiProperties.position?.default, 'end');
  });

  it('declares create_directory.files as a string array', () => {
    const tool = kernel.tools.getTool('create_directory');

    assert.ok(tool);
    const properties = tool.parametersSchema.properties as Record<string, unknown>;
    const files = properties.files as { type?: string; items?: { type?: string } };

    assert.equal(files.type, 'array');
    assert.equal(files.items?.type, 'string');
  });

  it('keeps every filesystem tool inside the live registry after activation', () => {
    for (const name of TOOL_NAMES) {
      assert.ok(kernel.tools.getTool(name), `${name} disappeared after activation`);
    }
  });
});