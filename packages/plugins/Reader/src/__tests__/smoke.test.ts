import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LineRangeError,
  buildBinaryEntry,
  buildTextEntry,
  computeLineRange,
  countTotalLines,
  sliceLineRange,
  summarizeReadResult,
  buildReadResult,
} from '../envelope.js';
import {
  ByteBudget,
  MAX_FILES_PER_BATCH,
  MAX_CONCURRENCY,
  DEFAULT_MAX_BYTES,
  BINARY_SNIFF_BYTES,
  GovernorError,
  assertBatchLimit,
  isExcludedPath,
  splitCommaList,
} from '../governor.js';
import { isBinaryBytes, toWorkspacePath, toAbsolutePath } from '../readEngine.js';
import {
  READ_DIRECTORY_SCHEMA,
  READ_FILES_SCHEMA,
  READ_FILE_SCHEMA,
} from '../schemas.js';

describe('reader governor', () => {
  it('exposes the ratified ceilings', () => {
    assert.equal(MAX_FILES_PER_BATCH, 100);
    assert.equal(DEFAULT_MAX_BYTES, 8 * 1024 * 1024);
    assert.equal(MAX_CONCURRENCY, 16);
    assert.equal(BINARY_SNIFF_BYTES, 8192);
  });

  it('refuses batches above the file ceiling', () => {
    assert.doesNotThrow(() => assertBatchLimit(MAX_FILES_PER_BATCH));
    assert.throws(
      () => assertBatchLimit(MAX_FILES_PER_BATCH + 1),
      (error: unknown) => error instanceof GovernorError
        && error.code === 'BATCH_LIMIT_EXCEEDED'
        && error.message === 'Read batch too large.',
    );
  });

  it('admits bytes until the budget is exhausted', () => {
    const budget = new ByteBudget(10);

    assert.equal(budget.tryAdmit(6), true);
    assert.equal(budget.tryAdmit(5), false);
    assert.equal(budget.usedBytes, 6);
    assert.equal(budget.tryAdmit(4), true);
    assert.equal(budget.remainingBytes, 0);
  });

  it('matches glob and substring exclusions', () => {
    assert.equal(isExcludedPath('src/a.test.ts', ['**/*.test.ts']), true);
    assert.equal(isExcludedPath('src/a.ts', ['**/*.test.ts']), false);
    assert.equal(isExcludedPath('src/generated/a.ts', ['generated']), true);
    assert.equal(isExcludedPath('src/A.TS', ['a.ts']), true);
    assert.equal(isExcludedPath('src/a.ts', undefined), false);
  });

  it('splits comma lists without breaking brace alternatives', () => {
    assert.deepEqual(splitCommaList('{a,b}.ts, c.ts'), ['{a,b}.ts', 'c.ts']);
    assert.deepEqual(splitCommaList(undefined), []);
  });
});

describe('reader envelope', () => {
  it('counts lines the legacy way', () => {
    assert.equal(countTotalLines(''), 0);
    assert.equal(countTotalLines('a'), 1);
    assert.equal(countTotalLines('a\nb'), 2);
    assert.equal(countTotalLines('a\nb\n'), 2);
  });

  it('clamps the end line to EOF', () => {
    assert.deepEqual(computeLineRange(2, 99, 3), { startLine: 2, endLine: 3, totalLines: 3 });
    assert.deepEqual(computeLineRange(undefined, undefined, 3), { startLine: 1, endLine: 3, totalLines: 3 });
  });

  it('rejects invalid line ranges', () => {
    assert.throws(
      () => computeLineRange(0, 1, 3),
      (error: unknown) => error instanceof LineRangeError && error.code === 'INVALID_LINE_RANGE',
    );
    assert.throws(() => computeLineRange(4, 5, 3), LineRangeError);
    assert.throws(() => computeLineRange(1, 1, 0), LineRangeError);
  });

  it('slices content and preserves a trailing newline', () => {
    assert.equal(
      sliceLineRange('a\nb\nc\n', { startLine: 2, endLine: 2, totalLines: 3 }),
      'b\n',
    );
  });

  it('builds unsliced and sliced text entries', () => {
    const full = buildTextEntry('src/a.ts', 'a\nb\n');
    assert.deepEqual(full, {
      path: 'src/a.ts',
      content: 'a\nb\n',
      size: 4,
      startLine: 1,
      endLine: 2,
      totalLines: 2,
    });

    const sliced = buildTextEntry('src/a.ts', 'a\nb\nc\n', { startLine: 2, endLine: 2 });
    assert.equal(sliced.content, 'b\n');
    assert.equal(sliced.startLine, 2);
    assert.equal(sliced.endLine, 2);
    assert.equal(sliced.totalLines, 3);
  });

  it('builds a binary entry with zeroed lines', () => {
    assert.deepEqual(buildBinaryEntry('img.png', 10, { isImported: true, importedFrom: 'a.ts' }), {
      path: 'img.png',
      size: 10,
      startLine: 0,
      endLine: 0,
      totalLines: 0,
      isImported: true,
      importedFrom: 'a.ts',
      isBinary: true,
    });
  });

  it('aggregates totals and summarizes', () => {
    const result = buildReadResult(
      [buildTextEntry('a.ts', 'a'), buildTextEntry('b.ts', 'bb')],
      [],
      false,
      undefined,
    );

    assert.equal(result.totalFiles, 2);
    assert.equal(result.totalSize, 3);
    assert.match(summarizeReadResult(result), /delivered=2 file\(s\), bytes=3, skipped=0/u);
  });
});

describe('reader binary sniff', () => {
  it('detects null and high bytes within the sample window', () => {
    assert.equal(isBinaryBytes(new Uint8Array([0x61, 0x62, 0x63])), false);
    assert.equal(isBinaryBytes(new Uint8Array([0x61, 0x00, 0x63])), true);
    assert.equal(isBinaryBytes(new Uint8Array([0x61, 0xFF])), true);
  });

  it('keeps valid UTF-8 text readable', () => {
    assert.equal(isBinaryBytes(new Uint8Array([0x63, 0x61, 0x66, 0xc3, 0xa9])), false);
  });

  it('ignores bytes after the sample window', () => {
    const bytes = new Uint8Array(BINARY_SNIFF_BYTES + 1);
    bytes.fill(0x61);
    bytes[BINARY_SNIFF_BYTES] = 0x00;

    assert.equal(isBinaryBytes(bytes), false);
  });
});

describe('reader path model', () => {
  it('returns workspace-relative paths', () => {
    assert.equal(toWorkspacePath('/workspace/src/a.ts', '/workspace'), 'src/a.ts');
    assert.equal(toWorkspacePath('./src/a.ts', '/workspace'), 'src/a.ts');
    assert.equal(toWorkspacePath('src\\a.ts', '/workspace'), 'src/a.ts');
  });

  it('resolves relative paths against the workspace root', () => {
    assert.equal(toAbsolutePath('src/a.ts', '/workspace'), '/workspace/src/a.ts');
  });
});

describe('reader schemas', () => {
  it('forbid additional properties and require their root field', () => {
    for (const [schema, required] of [
      [READ_FILE_SCHEMA, 'filePath'],
      [READ_FILES_SCHEMA, 'pattern'],
      [READ_DIRECTORY_SCHEMA, 'directoryPath'],
    ] as const) {
      assert.equal(schema.type, 'object');
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual(schema.required, [required]);
    }
  });
});