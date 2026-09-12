import { describe, it } from 'node:test';
import assert from 'node:assert';
import { extractMetadata, parseMetadataLines } from './metadata.js';
import { parseOperationsWithMetadata } from './index.js';
import { BrudError } from '../api/index.js';

function expectBrudError(fn: () => void, code: string, messageSubstring?: string) {
  try {
    fn();
    assert.fail('Expected BrudError to be thrown');
  } catch (err) {
    assert.ok(err instanceof BrudError, `Expected BrudError, got ${typeof err}`);
    assert.strictEqual(err.code, code, `Expected code ${code}, got ${err.code}`);
    if (messageSubstring) {
      assert.ok(err.details.includes(messageSubstring) || err.friendly.includes(messageSubstring),
        `Expected message to contain "${messageSubstring}", got "${err.details}"`);
    }
  }
}

describe('Metadata Parser - extractMetadata', () => {

  it('extracts session metadata with title only', () => {
    const input = `<session_metadata>
title: My Session Title
</session_metadata>
<<<<<<< CREATE_FILE [1]
File Path: test.txt
Content:
hello
=======
>>>>>>> END CREATE_FILE [1]`;
    const result = extractMetadata(input);
    assert.ok(result.sessionMetadata);
    assert.strictEqual(result.sessionMetadata!.title, 'My Session Title');
    assert.strictEqual(result.sessionMetadata!.description, undefined);
    assert.ok(!result.cleanedInput.includes('<session_metadata>'));
    assert.ok(result.cleanedInput.includes('<<<<<<< CREATE_FILE [1]'));
  });

  it('extracts session metadata with description only', () => {
    const input = `<session_metadata>
description: A session description
</session_metadata>
<<<<<<< CREATE_FILE [1]
File Path: test.txt
Content:
hello
=======
>>>>>>> END CREATE_FILE [1]`;
    const result = extractMetadata(input);
    assert.ok(result.sessionMetadata);
    assert.strictEqual(result.sessionMetadata!.title, undefined);
    assert.strictEqual(result.sessionMetadata!.description, 'A session description');
  });

  it('extracts session metadata with both fields', () => {
    const input = `<session_metadata>
title: Refactor Auth
description: Updates the auth module
</session_metadata>
<<<<<<< CREATE_FILE [1]
File Path: test.txt
Content:
hello
=======
>>>>>>> END CREATE_FILE [1]`;
    const result = extractMetadata(input);
    assert.ok(result.sessionMetadata);
    assert.strictEqual(result.sessionMetadata!.title, 'Refactor Auth');
    assert.strictEqual(result.sessionMetadata!.description, 'Updates the auth module');
  });

  it('returns empty metadata when neither wrapper is present', () => {
    const input = `<<<<<<< CREATE_FILE [1]
File Path: test.txt
Content:
hello
=======
>>>>>>> END CREATE_FILE [1]`;
    const result = extractMetadata(input);
    assert.strictEqual(result.sessionMetadata, undefined);
    assert.strictEqual(result.operationMetadata.size, 0);
    assert.strictEqual(result.cleanedInput, input);
  });

  it('extracts operation metadata', () => {
    const input = `<<<<<<< CREATE_FILE [1]
<operation_metadata>
title: Create config
description: Creates the app config file
</operation_metadata>
File Path: test.txt
Content:
hello
=======
>>>>>>> END CREATE_FILE [1]`;
    const result = extractMetadata(input);
    assert.strictEqual(result.sessionMetadata, undefined);
    assert.strictEqual(result.operationMetadata.size, 1);
    const meta = result.operationMetadata.get('1');
    assert.ok(meta);
    assert.strictEqual(meta!.title, 'Create config');
    assert.strictEqual(meta!.description, 'Creates the app config file');
    assert.ok(!result.cleanedInput.includes('<operation_metadata>'));
  });

  it('extracts both session and operation metadata', () => {
    const input = `<session_metadata>
title: Setup Project
</session_metadata>
<<<<<<< CREATE_FILE [1]
<operation_metadata>
title: Create config
</operation_metadata>
File Path: test.txt
Content:
hello
=======
>>>>>>> END CREATE_FILE [1]`;
    const result = extractMetadata(input);
    assert.ok(result.sessionMetadata);
    assert.strictEqual(result.sessionMetadata!.title, 'Setup Project');
    assert.strictEqual(result.operationMetadata.size, 1);
    assert.strictEqual(result.operationMetadata.get('1')!.title, 'Create config');
    assert.ok(!result.cleanedInput.includes('<session_metadata>'));
    assert.ok(!result.cleanedInput.includes('<operation_metadata>'));
  });

  it('throws on wrong case wrapper', () => {
    const input = `<Session_Metadata>
title: Test
</Session_Metadata>`;
    expectBrudError(
      () => extractMetadata(input),
      'E_METADATA_WRONG_CASE',
      'Session_Metadata',
    );
  });

  it('throws on uppercase wrapper', () => {
    const input = `<SESSION_METADATA>
title: Test
</SESSION_METADATA>`;
    expectBrudError(
      () => extractMetadata(input),
      'E_METADATA_WRONG_CASE',
      'SESSION_METADATA',
    );
  });

  it('throws on duplicate session metadata', () => {
    const input = `<session_metadata>
title: First
</session_metadata>
<session_metadata>
title: Second
</session_metadata>`;
    expectBrudError(
      () => extractMetadata(input),
      'E_DUPLICATE_SESSION_METADATA',
    );
  });

  it('throws on duplicate operation metadata', () => {
    const input = `<<<<<<< CREATE_FILE [1]
<operation_metadata>
title: First
</operation_metadata>
<operation_metadata>
title: Second
</operation_metadata>
File Path: test.txt
Content:
hello
=======
>>>>>>> END CREATE_FILE [1]`;
    expectBrudError(
      () => extractMetadata(input),
      'E_DUPLICATE_OPERATION_METADATA',
    );
  });

  it('throws on wrong case field name', () => {
    const input = `<session_metadata>
Title: My Session
</session_metadata>`;
    expectBrudError(
      () => extractMetadata(input),
      'E_METADATA_FIELD_CASE',
      'Title',
    );
  });

  it('throws on unknown field name', () => {
    const input = `<session_metadata>
author: John
</session_metadata>`;
    expectBrudError(
      () => extractMetadata(input),
      'E_METADATA_UNKNOWN_FIELD',
      'author',
    );
  });

  it('throws on session metadata not at position 0', () => {
    const input = `<<<<<<< CREATE_FILE [1]
File Path: test.txt
Content:
hello
=======
>>>>>>> END CREATE_FILE [1]
<session_metadata>
title: Late
</session_metadata>`;
    expectBrudError(
      () => extractMetadata(input),
      'E_SESSION_METADATA_POSITION',
    );
  });

  it('parses multiline description correctly', () => {
    const input = `<session_metadata>
title: Project Init
description: This is a long description
  that spans multiple lines
  with indented continuation
</session_metadata>`;
    const result = extractMetadata(input);
    assert.ok(result.sessionMetadata);
    assert.strictEqual(result.sessionMetadata!.title, 'Project Init');
    assert.strictEqual(result.sessionMetadata!.description, 'This is a long description\nthat spans multiple lines\nwith indented continuation');
  });

  it('handles unicode and emoji in metadata values', () => {
    const input = `<session_metadata>
title: বাংলা শিরোনাম
description: This has emoji 🎉 and Unicode 文字
</session_metadata>`;
    const result = extractMetadata(input);
    assert.ok(result.sessionMetadata);
    assert.strictEqual(result.sessionMetadata!.title, 'বাংলা শিরোনাম');
    assert.strictEqual(result.sessionMetadata!.description, 'This has emoji 🎉 and Unicode 文字');
  });

  it('throws on unterminated session metadata wrapper', () => {
    const input = `<session_metadata>
title: Unclosed
`;
    expectBrudError(
      () => extractMetadata(input),
      'E_METADATA_UNCLOSED',
      'session_metadata',
    );
  });

  it('throws on unterminated operation metadata wrapper', () => {
    const input = `<<<<<<< CREATE_FILE [1]
<operation_metadata>
title: Unclosed
File Path: test.txt
Content:
hello
=======
>>>>>>> END CREATE_FILE [1]`;
    expectBrudError(
      () => extractMetadata(input),
      'E_METADATA_UNCLOSED',
      'operation_metadata',
    );
  });

  it('handles empty title value', () => {
    const input = `<session_metadata>
title:
description: Some desc
</session_metadata>`;
    const result = extractMetadata(input);
    assert.ok(result.sessionMetadata);
    assert.strictEqual(result.sessionMetadata!.title, '');
    assert.strictEqual(result.sessionMetadata!.description, 'Some desc');
  });
});

describe('Metadata Parser - parseMetadataLines', () => {

  it('parses title and description from key-value lines', () => {
    const result = parseMetadataLines('title: Hello\ndescription: World');
    assert.strictEqual(result.title, 'Hello');
    assert.strictEqual(result.description, 'World');
  });

  it('parses only title when description absent', () => {
    const result = parseMetadataLines('title: Only Title');
    assert.strictEqual(result.title, 'Only Title');
    assert.strictEqual(result.description, undefined);
  });

  it('parses only description when title absent', () => {
    const result = parseMetadataLines('description: Only Description');
    assert.strictEqual(result.title, undefined);
    assert.strictEqual(result.description, 'Only Description');
  });

  it('parses multiline description with indentation', () => {
    const result = parseMetadataLines('title: Test\ndescription: Line 1\n  Line 2\n  Line 3');
    assert.strictEqual(result.title, 'Test');
    assert.strictEqual(result.description, 'Line 1\nLine 2\nLine 3');
  });

  it('throws on wrong case field', () => {
    assert.throws(() => parseMetadataLines('Title: Wrong'), (err: any) => {
      return err.code === 'E_METADATA_FIELD_CASE';
    });
  });

  it('throws on unknown field', () => {
    assert.throws(() => parseMetadataLines('invalid: value'), (err: any) => {
      return err.code === 'E_METADATA_UNKNOWN_FIELD';
    });
  });
});

describe('Metadata Parser - parseOperationsWithMetadata', () => {

  it('returns operations with session metadata', () => {
    const input = `<session_metadata>
title: Test Session
</session_metadata>
<<<<<<< CREATE_FILE [1]
File Path: test.txt
Content:
hello
=======
>>>>>>> END CREATE_FILE [1]`;
    const result = parseOperationsWithMetadata(input, ['/workspace']);
    assert.ok(result.sessionMetadata);
    assert.strictEqual(result.sessionMetadata!.title, 'Test Session');
    assert.strictEqual(result.operations.length, 1);
    assert.strictEqual(result.operations[0].kind, 'create_file');
  });

  it('returns operations without session metadata when absent', () => {
    const input = `<<<<<<< CREATE_FILE [1]
File Path: test.txt
Content:
hello
=======
>>>>>>> END CREATE_FILE [1]`;
    const result = parseOperationsWithMetadata(input, ['/workspace']);
    assert.strictEqual(result.sessionMetadata, undefined);
    assert.strictEqual(result.operations.length, 1);
  });

  it('returns identical operations to parseOperations when no metadata', () => {
    const input = `<<<<<<< CREATE_FILE [1]
File Path: test.txt
Content:
hello
=======
>>>>>>> END CREATE_FILE [1]`;
    const result = parseOperationsWithMetadata(input, ['/workspace']);
    assert.strictEqual(result.operations.length, 1);
    assert.strictEqual(result.operations[0].kind, 'create_file');
  });

  it('attaches metadata to operations by index', () => {
    const input = `<<<<<<< CREATE_FILE [1]
<operation_metadata>
title: Op One
</operation_metadata>
File Path: a.txt
Content:
a
=======
>>>>>>> END CREATE_FILE [1]
<<<<<<< CREATE_FILE [2]
File Path: b.txt
Content:
b
=======
>>>>>>> END CREATE_FILE [2]
<<<<<<< CREATE_FILE [3]
<operation_metadata>
title: Op Three
</operation_metadata>
File Path: c.txt
Content:
c
=======
>>>>>>> END CREATE_FILE [3]`;
    const result = parseOperationsWithMetadata(input, ['/workspace']);
    assert.strictEqual(result.operations.length, 3);
    assert.strictEqual((result.operations[0] as any).title, 'Op One');
    assert.strictEqual((result.operations[1] as any).title, undefined);
    assert.strictEqual((result.operations[2] as any).title, 'Op Three');
  });
});