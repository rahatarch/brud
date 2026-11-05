import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CREATE_FILE_SCHEMA,
} from '../groups/file/createFile/index.js';
import {
  DELETE_FILE_SCHEMA,
} from '../groups/file/deleteFile/index.js';
import {
  RENAME_FILE_SCHEMA,
} from '../groups/file/renameFile/index.js';
import {
  MOVE_FILE_SCHEMA,
} from '../groups/file/moveFile/index.js';
import {
  COPY_FILE_SCHEMA,
} from '../groups/file/copyFile/index.js';
import {
  APPEND_FILE_SCHEMA,
} from '../groups/file/appendFile/index.js';
import {
  CREATE_DIRECTORY_SCHEMA,
} from '../groups/directory/createDirectory/index.js';
import {
  DELETE_DIRECTORY_SCHEMA,
} from '../groups/directory/deleteDirectory/index.js';
import {
  MOVE_DIRECTORY_SCHEMA,
} from '../groups/directory/moveDirectory/index.js';
import {
  APPEND_FILE_MULTI_SCHEMA,
} from '../groups/multi/appendFileMulti/index.js';
import {
  SEARCH_REPLACE_SCHEMA,
} from '../groups/multi/searchReplace/index.js';
import {
  SEARCH_REPLACE_MULTI_SCHEMA,
} from '../groups/multi/searchReplaceMulti/index.js';
import { acquireCrossTestLock, releaseCrossTestLock } from './support/serialLock.js';

interface SchemaCase {
  readonly name: string;
  readonly schema: Record<string, unknown>;
  readonly properties: readonly string[];
  readonly required: readonly string[];
}

const CASES: readonly SchemaCase[] = [
  {
    name: 'create_file',
    schema: CREATE_FILE_SCHEMA,
    properties: ['path', 'content'],
    required: ['path', 'content'],
  },
  {
    name: 'delete_file',
    schema: DELETE_FILE_SCHEMA,
    properties: ['path'],
    required: ['path'],
  },
  {
    name: 'rename_file',
    schema: RENAME_FILE_SCHEMA,
    properties: ['from', 'to'],
    required: ['from', 'to'],
  },
  {
    name: 'move_file',
    schema: MOVE_FILE_SCHEMA,
    properties: ['from', 'to'],
    required: ['from', 'to'],
  },
  {
    name: 'copy_file',
    schema: COPY_FILE_SCHEMA,
    properties: ['from', 'to'],
    required: ['from', 'to'],
  },
  {
    name: 'append_file',
    schema: APPEND_FILE_SCHEMA,
    properties: ['path', 'position', 'content'],
    required: ['path', 'content'],
  },
  {
    name: 'create_directory',
    schema: CREATE_DIRECTORY_SCHEMA,
    properties: ['directoryPath', 'files'],
    required: ['directoryPath'],
  },
  {
    name: 'delete_directory',
    schema: DELETE_DIRECTORY_SCHEMA,
    properties: ['directoryPath'],
    required: ['directoryPath'],
  },
  {
    name: 'move_directory',
    schema: MOVE_DIRECTORY_SCHEMA,
    properties: ['from', 'to'],
    required: ['from', 'to'],
  },
  {
    name: 'append_file_multi',
    schema: APPEND_FILE_MULTI_SCHEMA,
    properties: ['pattern', 'scope', 'position', 'content'],
    required: ['pattern', 'content'],
  },
  {
    name: 'search_replace',
    schema: SEARCH_REPLACE_SCHEMA,
    properties: ['path', 'search', 'replace'],
    required: ['path', 'search', 'replace'],
  },
  {
    name: 'search_replace_multi',
    schema: SEARCH_REPLACE_MULTI_SCHEMA,
    properties: ['pattern', 'scope', 'search', 'replace'],
    required: ['pattern', 'search', 'replace'],
  },
];

before(async () => {
  await acquireCrossTestLock();
});

after(async () => {
  await releaseCrossTestLock();
});

describe('schema conformance', () => {
  it('registers exactly twelve schemas', () => {
    assert.equal(CASES.length, 12);
  });

  for (const testCase of CASES) {
    it(`${testCase.name} matches the discovery audit`, () => {
      assert.equal(testCase.schema.type, 'object');
      assert.equal(testCase.schema.additionalProperties, false);

      const properties = testCase.schema.properties as Record<string, unknown>;

      assert.ok(properties, 'properties must be present');
      assert.deepEqual(Object.keys(properties).sort(), [...testCase.properties].sort());
      assert.deepEqual(
        [...(testCase.schema.required as string[])].sort(),
        [...testCase.required].sort(),
      );

      assert.equal('index' in properties, false, 'index must not be exposed');
      assert.equal(
        (testCase.schema.required as string[]).includes('index'),
        false,
        'index must not be required',
      );
      assert.equal(
        JSON.stringify(testCase.schema).includes('"index"'),
        false,
        'index must not appear anywhere in the schema',
      );
    });
  }
});