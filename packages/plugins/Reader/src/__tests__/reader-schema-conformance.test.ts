import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OperationResult } from '@brud/kernel';
import {
  READ_DIRECTORY_SCHEMA,
  READ_FILES_SCHEMA,
  READ_FILE_SCHEMA,
} from '../schemas.js';
import { readerManifest } from '../plugin.js';
import {
  bootReaderKernel,
  instrumentFileSystem,
  type ReaderHarness,
} from './reader-test-helpers.js';

const FILE_PROPERTIES = [
  'filePath',
  'isImportRead',
  'maxDepth',
  'importSyntax',
  'exclude',
  'startLine',
  'endLine',
] as const;

const FILES_PROPERTIES = ['pattern', 'scope', 'maxResults', 'isImportRead'] as const;
const DIRECTORY_PROPERTIES = ['directoryPath', 'recursive', 'exclude'] as const;

const LEGACY_ARTIFACT_KEYS = [
  'index',
  'kind',
  'operationKind',
  'toolName',
  'operation',
] as const;

function propertiesOf(schema: Record<string, unknown>): string[] {
  return Object.keys(schema.properties as Record<string, unknown>).sort();
}

function validationFailure(result: OperationResult, tool: string): void {
  assert.equal(result.status, 'failed');
  assert.ok(
    String(result.error).startsWith(`TOOL_VALIDATION_ERROR: Tool "${tool}" input rejected:`),
    `expected TOOL_VALIDATION_ERROR, received: ${String(result.error)}`,
  );
}

describe('Goal 1 — schema conformance', () => {
  it('registers read_file with exactly the audited property set', async (t) => {
    const harness = await bootReaderKernel(t);
    const registered = harness.tools.getTool('read_file');

    assert.ok(registered !== undefined);
    assert.deepEqual(propertiesOf(registered.parametersSchema), [...FILE_PROPERTIES].sort());
  });

  it('registers read_files with exactly the audited property set', async (t) => {
    const harness = await bootReaderKernel(t);
    const registered = harness.tools.getTool('read_files');

    assert.ok(registered !== undefined);
    assert.deepEqual(propertiesOf(registered.parametersSchema), [...FILES_PROPERTIES].sort());
  });

  it('registers read_directory with exactly the audited property set', async (t) => {
    const harness = await bootReaderKernel(t);
    const registered = harness.tools.getTool('read_directory');

    assert.ok(registered !== undefined);
    assert.deepEqual(propertiesOf(registered.parametersSchema), [...DIRECTORY_PROPERTIES].sort());
  });

  it('has no index field in any of the three schemas', () => {
    for (const schema of [READ_FILE_SCHEMA, READ_FILES_SCHEMA, READ_DIRECTORY_SCHEMA]) {
      assert.equal(Object.hasOwn(schema.properties as object, 'index'), false);
      assert.equal(JSON.stringify(schema).includes('"index"'), false);
    }
  });

  it('carries no legacy 21-kind artifacts', () => {
    for (const schema of [READ_FILE_SCHEMA, READ_FILES_SCHEMA, READ_DIRECTORY_SCHEMA]) {
      for (const key of LEGACY_ARTIFACT_KEYS) {
        assert.equal(Object.hasOwn(schema.properties as object, key), false, key);
      }

      assert.equal(Object.hasOwn(schema, 'index'), false);
    }
  });

  it('sets additionalProperties false on all three schemas', () => {
    for (const schema of [READ_FILE_SCHEMA, READ_FILES_SCHEMA, READ_DIRECTORY_SCHEMA]) {
      assert.equal(schema.additionalProperties, false);
    }
  });

  it('requires exactly filePath, pattern, and directoryPath', () => {
    assert.deepEqual(READ_FILE_SCHEMA.required, ['filePath']);
    assert.deepEqual(READ_FILES_SCHEMA.required, ['pattern']);
    assert.deepEqual(READ_DIRECTORY_SCHEMA.required, ['directoryPath']);
  });

  it('declares the audited defaults', () => {
    const fileProperties = READ_FILE_SCHEMA.properties as Record<string, Record<string, unknown>>;
    const filesProperties = READ_FILES_SCHEMA.properties as Record<string, Record<string, unknown>>;
    const directoryProperties = READ_DIRECTORY_SCHEMA.properties as Record<string, Record<string, unknown>>;

    assert.equal(fileProperties.isImportRead?.default, false);
    assert.equal(fileProperties.maxDepth?.default, 0);
    assert.equal(filesProperties.isImportRead?.default, false);
    assert.equal(directoryProperties.recursive?.default, false);
  });

  it('does not attach defaults to fields that have none', () => {
    const fileProperties = READ_FILE_SCHEMA.properties as Record<string, Record<string, unknown>>;

    for (const field of ['filePath', 'importSyntax', 'exclude', 'startLine', 'endLine']) {
      assert.equal(Object.hasOwn(fileProperties[field]!, 'default'), false, field);
    }
  });

  it('declares the audited JSON types', () => {
    const fileProperties = READ_FILE_SCHEMA.properties as Record<string, Record<string, unknown>>;
    const filesProperties = READ_FILES_SCHEMA.properties as Record<string, Record<string, unknown>>;
    const directoryProperties = READ_DIRECTORY_SCHEMA.properties as Record<string, Record<string, unknown>>;

    assert.equal(fileProperties.filePath?.type, 'string');
    assert.equal(fileProperties.isImportRead?.type, 'boolean');
    assert.equal(fileProperties.maxDepth?.type, 'number');
    assert.equal(fileProperties.importSyntax?.type, 'string');
    assert.equal(fileProperties.exclude?.type, 'string');
    assert.equal(fileProperties.startLine?.type, 'number');
    assert.equal(fileProperties.endLine?.type, 'number');

    assert.equal(filesProperties.pattern?.type, 'string');
    assert.equal(filesProperties.scope?.type, 'string');
    assert.equal(filesProperties.maxResults?.type, 'number');
    assert.equal(filesProperties.isImportRead?.type, 'boolean');

    assert.equal(directoryProperties.directoryPath?.type, 'string');
    assert.equal(directoryProperties.recursive?.type, 'boolean');
    assert.equal(directoryProperties.exclude?.type, 'string');
  });

  it('publishes the same schemas through the registry as the module exports', async (t) => {
    const harness = await bootReaderKernel(t);

    assert.deepEqual(harness.tools.getTool('read_file')?.parametersSchema, READ_FILE_SCHEMA);
    assert.deepEqual(harness.tools.getTool('read_files')?.parametersSchema, READ_FILES_SCHEMA);
    assert.deepEqual(
      harness.tools.getTool('read_directory')?.parametersSchema,
      READ_DIRECTORY_SCHEMA,
    );
  });

  it('registers the three tools with descriptive text', async (t) => {
    const harness = await bootReaderKernel(t);

    for (const name of ['read_file', 'read_files', 'read_directory']) {
      const tool = harness.tools.getTool(name);
      assert.ok(tool !== undefined);
      assert.ok(tool.description.length > 0);
      assert.equal(tool.ownerPluginId, readerManifest.id);
    }
  });

  it('declares exactly the fs:read, tools:register, and tools:execute permissions', () => {
    assert.deepEqual(
      [...(readerManifest.permissions ?? [])].sort(),
      ['fs:read', 'tools:execute', 'tools:register'],
    );
  });

  it('rejects a read_file payload missing filePath with TOOL_VALIDATION_ERROR', async (t) => {
    const harness = await bootReaderKernel(t);
    const probe = instrumentFileSystem(harness.fs);

    const result = await harness.call('read_file', {});

    validationFailure(result, 'read_file');
    assert.equal(probe.readCalls, 0);
    probe.restore();
  });

  it('rejects an unexpected property with TOOL_VALIDATION_ERROR', async (t) => {
    const harness = await bootReaderKernel(t);
    const probe = instrumentFileSystem(harness.fs);

    const result = await harness.call('read_file', {
      filePath: 'missing.txt',
      legacyKind: 'read_file',
    });

    validationFailure(result, 'read_file');
    assert.equal(probe.readCalls, 0);
    probe.restore();
  });

  it('rejects a wrong-typed property with TOOL_VALIDATION_ERROR', async (t) => {
    const harness = await bootReaderKernel(t);

    validationFailure(
      await harness.call('read_file', { filePath: 42 }),
      'read_file',
    );
    validationFailure(
      await harness.call('read_files', { pattern: ['a.txt'] }),
      'read_files',
    );
    validationFailure(
      await harness.call('read_directory', { directoryPath: true }),
      'read_directory',
    );
  });

  it('rejects missing required fields on read_files and read_directory', async (t) => {
    const harness = await bootReaderKernel(t);

    validationFailure(await harness.call('read_files', {}), 'read_files');
    validationFailure(await harness.call('read_directory', {}), 'read_directory');
  });
});