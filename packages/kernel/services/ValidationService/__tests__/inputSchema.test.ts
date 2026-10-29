import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ValidationPolicy } from '../contracts/IValidationService.js';
import { InputSchemaEngine } from '../engine/InputSchemaEngine.js';
import {
  KNOWN_OPERATION_KINDS,
  KIND_CONSTRAINTS,
  PREVIEW_SUPPORTED_KINDS,
  kindConstraint,
} from '../engine/kindMatrix.js';
import { computeLineRange, countTotalLines, sliceLineRange } from '../engine/lineRange.js';

function policy(overrides?: Partial<ValidationPolicy>): ValidationPolicy {
  return {
    workspaceBoundaryEnabled: true,
    commandValidationEnabled: true,
    toolAllowList: {},
    readConcurrency: 16,
    readMaxBatchFiles: 100,
    readMaxAggregateBytes: 8 * 1024 * 1024,
    schemaVersion: 1,
    ...overrides,
  };
}

const engine = new InputSchemaEngine(policy());

/** Minimal valid payload per kind, from the audited §4.2 required-field column. */
const VALID_PAYLOADS: Readonly<Record<string, unknown>> = {
  search_replace: { path: 'a.ts', search: 'a', replace: 'b', index: '1' },
  create_file: { path: 'a.ts', content: '', index: '1' },
  delete_file: { path: 'a.ts', index: '1' },
  rename_file: { from: 'a.ts', to: 'b.ts', index: '1' },
  move_file: { from: 'a.ts', to: 'b.ts', index: '1' },
  copy_file: { from: 'a.ts', to: 'b.ts', index: '1' },
  append_file: { path: 'a.ts', content: 'x', index: '1' },
  create_directory: { directoryPath: 'src', index: '1' },
  delete_directory: { directoryPath: 'src', index: '1' },
  move_directory: { from: 'src', to: 'dst', index: '1' },
  append_file_multi: { patterns: ['*.ts'], content: 'x', index: '1' },
  search_replace_multi: { patterns: ['*.ts'], search: 'a', replace: 'b', index: '1' },
  read_file: { path: 'a.ts', index: '1' },
  read_files: { patterns: ['*.ts'], index: '1' },
  read_directory: { directoryPath: 'src', index: '1' },
  search_files: { patterns: ['*.ts'], index: '1' },
  extract_structure: { directoryPath: 'src', index: '1' },
  codebase_metadata: { index: '1' },
  terminal_command: { command: 'ls', index: '1' },
  terminal_interactive: { command: 'ls', answers: [], index: '1' },
  get_tool_info: { index: '1' },
};

describe('kindMatrix — 21-kind constraint matrix', () => {
  it('enumerates exactly the 21 catalogued kinds in legacy order', () => {
    assert.equal(KNOWN_OPERATION_KINDS.length, 21);
    assert.equal(KIND_CONSTRAINTS.length, 21);
    assert.deepEqual([...KNOWN_OPERATION_KINDS], [
      'search_replace',
      'create_file',
      'delete_file',
      'rename_file',
      'move_file',
      'copy_file',
      'append_file',
      'append_file_multi',
      'search_replace_multi',
      'create_directory',
      'delete_directory',
      'move_directory',
      'extract_structure',
      'codebase_metadata',
      'search_files',
      'read_file',
      'read_files',
      'read_directory',
      'terminal_interactive',
      'terminal_command',
      'get_tool_info',
    ]);
  });

  it('splits the catalog into 12 mutating, 6 read, 2 terminal, 1 catalog kinds', () => {
    const groups = KIND_CONSTRAINTS.reduce<Record<string, number>>((counts, constraint) => {
      counts[constraint.group] = (counts[constraint.group] ?? 0) + 1;

      return counts;
    }, {});

    assert.deepEqual(groups, { mutating: 12, read: 6, terminal: 2, catalog: 1 });
  });

  it('marks exactly the mutating and deleting kinds as A10-gated', () => {
    const gated = KIND_CONSTRAINTS
      .filter((constraint) => constraint.access === 'mutate' || constraint.access === 'delete')
      .map((constraint) => constraint.kind);

    assert.equal(gated.length, 14);
    assert.ok(gated.includes('create_directory'));
    assert.ok(gated.includes('delete_directory'));
    assert.ok(!gated.includes('read_file'));
  });

  it('gives every kind a valid payload in the matrix fixture', () => {
    assert.deepEqual(new Set(Object.keys(VALID_PAYLOADS)), new Set(KNOWN_OPERATION_KINDS));
  });

  it('records the audited per-kind path fields', () => {
    assert.deepEqual(kindConstraint('rename_file')?.paths.map((entry) => entry.field), ['from', 'to']);
    assert.deepEqual(kindConstraint('create_directory')?.paths.map((entry) => entry.field), ['directoryPath']);
    assert.deepEqual(kindConstraint('read_files')?.paths.map((entry) => entry.field), ['directory']);
    assert.deepEqual(kindConstraint('get_tool_info')?.paths, []);
  });

  it('marks line-range and batch-governed kinds', () => {
    const ranged = KIND_CONSTRAINTS.filter((entry) => entry.supportsLineRange).map((entry) => entry.kind);
    const batched = KIND_CONSTRAINTS.filter((entry) => entry.subjectToBatchLimit).map((entry) => entry.kind);

    assert.deepEqual(ranged, ['read_file', 'read_files', 'read_directory']);
    assert.deepEqual(batched, ['read_file', 'read_files', 'read_directory']);
  });
});

describe('InputSchemaEngine — field presence across all 21 kinds', () => {
  for (const kind of KNOWN_OPERATION_KINDS) {
    it(`${kind}: accepts a valid payload`, () => {
      assert.deepEqual(engine.validate({ kind, input: VALID_PAYLOADS[kind] }), { ok: true });
    });

    it(`${kind}: rejects a payload without an index`, () => {
      const payload = { ...(VALID_PAYLOADS[kind] as Record<string, unknown>) };
      delete payload['index'];

      const outcome = engine.validate({ kind, input: payload });

      assert.equal(outcome.ok, false);
      assert.equal(outcome.ok ? null : outcome.failure.rule, 'INPUT.MISSING_INDEX');
    });
  }

  it('reports INPUT.UNKNOWN_OPERATION for an uncatalogued kind', () => {
    const outcome = engine.validate({ kind: 'nope', input: {} });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok ? null : outcome.failure.rule, 'INPUT.UNKNOWN_OPERATION');
  });

  it('reports INPUT.TOOL_DISABLED when the allowlist says false', () => {
    const disabled = new InputSchemaEngine(policy({ toolAllowList: { create_file: false } }));

    const outcome = disabled.validate({ kind: 'create_file', input: VALID_PAYLOADS['create_file'] });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok ? null : outcome.failure.rule, 'INPUT.TOOL_DISABLED');
  });

  it('treats a missing allowlist key as enabled', () => {
    const partial = new InputSchemaEngine(policy({ toolAllowList: { delete_file: false } }));

    assert.equal(partial.isToolEnabled('create_file'), true);
    assert.equal(partial.isToolEnabled('delete_file'), false);
  });

  it('requires a non-blank string index', () => {
    assert.equal(engine.hasIndex({ index: '1' }), true);
    assert.equal(engine.hasIndex({ index: '   ' }), false);
    assert.equal(engine.hasIndex({ index: 1 }), false);
    assert.equal(engine.hasIndex(null), false);
  });

  it('requires the terminal executor for terminal kinds', () => {
    const outcome = engine.validate({
      kind: 'terminal_command',
      input: VALID_PAYLOADS['terminal_command'],
      terminalAvailable: false,
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok ? null : outcome.failure.rule, 'CMD.TERMINAL_UNAVAILABLE');
  });
});

describe('InputSchemaEngine — parameters', () => {
  it('validates position for append kinds', () => {
    assert.equal(engine.checkFields('append_file', { path: 'a', content: '', index: '1', position: 'start' }).ok, true);
    assert.equal(engine.checkFields('append_file', { path: 'a', content: '', index: '1', position: 'middle' }).ok, false);
    assert.equal(engine.checkFields('append_file_multi', { patterns: ['*'], content: '', index: '1', position: 'top' }).ok, false);
  });

  it('validates mode and command-or-commands for terminal_command', () => {
    assert.equal(engine.checkFields('terminal_command', { command: 'ls', index: '1', mode: 'parallel' }).ok, true);
    assert.equal(engine.checkFields('terminal_command', { command: 'ls', index: '1', mode: 'serial' }).ok, false);
    assert.equal(engine.checkFields('terminal_command', { commands: ['ls'], index: '1' }).ok, true);
    assert.equal(engine.checkFields('terminal_command', { index: '1' }).ok, false);
    assert.equal(engine.checkFields('terminal_command', { commands: 'ls', index: '1' }).ok, false);
  });

  it('requires an answers array for terminal_interactive', () => {
    assert.equal(engine.checkFields('terminal_interactive', { command: 'ls', answers: [], index: '1' }).ok, true);
    assert.equal(engine.checkFields('terminal_interactive', { command: 'ls', answers: 'y', index: '1' }).ok, false);
  });

  it('validates terminal request envelopes', () => {
    assert.equal(engine.validateTerminalRequest({ command: 'ls', terminalAvailable: true }).ok, true);
    assert.equal(engine.validateTerminalRequest({ terminalAvailable: true }).ok, false);
    assert.equal(engine.validateTerminalRequest({ command: 'ls', terminalAvailable: false }).ok, false);
    assert.equal(engine.validateTerminalRequest({ command: 'ls', mode: 'serial', terminalAvailable: true }).ok, false);
    assert.equal(engine.validateTerminalRequest({ command: 'ls', answers: 'x' as unknown as string[], terminalAvailable: true }).ok, false);
  });

  it('counts patterns and answers', () => {
    assert.equal(engine.hasPatterns(['*.ts']), true);
    assert.equal(engine.hasPatterns([]), false);
    assert.equal(engine.hasPatterns(null), false);
  });
});

describe('InputSchemaEngine — batch and message gates', () => {
  it('rejects an empty operation batch', () => {
    const empty = engine.validateOperations([]);

    assert.equal(empty.ok, false);
    assert.equal(empty.ok ? null : empty.failure.rule, 'INPUT.EMPTY_OPERATIONS');
  });

  it('rejects a batch with an uncatalogued kind', () => {
    const outcome = engine.validateOperations([{ kind: 'create_file' }, { kind: 'nope' }]);

    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok ? null : outcome.failure.rule, 'INPUT.UNKNOWN_OPERATION');
  });

  it('requires at least one extract_structure operation', () => {
    assert.equal(engine.validateExtractOperations([{ kind: 'extract_structure' }]).ok, true);
    assert.equal(engine.validateExtractOperations([{ kind: 'read_file' }]).ok, false);
    assert.equal(engine.validateExtractOperations(undefined).ok, false);
  });

  it('validates the legacy block format', () => {
    const valid = '<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE';

    assert.equal(engine.validateFormat(valid).ok, true);
    assert.equal(engine.validateFormat('no markers').ok, false);
  });

  it('validates preview eligibility', () => {
    assert.deepEqual([...PREVIEW_SUPPORTED_KINDS], ['search_replace', 'create_file', 'append_file']);
    assert.equal(engine.validatePreview('create_file', [{}]).ok, true);
    assert.equal(engine.validatePreview('create_file', []).ok, false);
    assert.equal(engine.validatePreview('read_file', [{}]).ok, false);
  });

  it('validates a single search match', () => {
    assert.equal(engine.validateSingleMatch('a.ts', 'foo bar', 'foo').ok, true);
    assert.equal(engine.validateSingleMatch('a.ts', 'foo bar', 'zzz').ok, false);
    assert.equal(engine.validateSingleMatch('a.ts', 'foo foo', 'foo').ok, false);
  });

  it('validates sessions and revert requests', () => {
    assert.equal(engine.validateSession('s1', { id: 's1' }).ok, true);
    assert.equal(engine.validateSession('s1', undefined).ok, false);
    assert.equal(engine.validateRevertRequest('s1', 'state').ok, true);
    assert.equal(engine.validateRevertRequest(undefined, 'state').ok, false);
  });

  it('validates write/delete target kind (V-3)', () => {
    assert.equal(engine.validateTargetKind('create_file', 'directory').ok, false);
    assert.equal(engine.validateTargetKind('create_file', 'file').ok, true);
    assert.equal(engine.validateTargetKind('delete_file', 'directory').ok, false);
    assert.equal(engine.validateTargetKind('delete_file', 'file').ok, true);
    assert.equal(engine.validateTargetKind('read_file', 'directory').ok, true);
  });
});

describe('InputSchemaEngine — batch limit', () => {
  it('admits a batch at the ceiling and rejects one above it', () => {
    assert.equal(engine.validateBatchLimit(100).ok, true);
    assert.equal(engine.validateBatchLimit(101).ok, false);
  });

  it('exempts import reads', () => {
    assert.equal(engine.validateBatchLimit(500, true).ok, true);
  });

  it('uses the frozen policy ceiling', () => {
    const small = new InputSchemaEngine(policy({ readMaxBatchFiles: 3 }));

    assert.equal(small.validateBatchLimit(3).ok, true);
    assert.equal(small.validateBatchLimit(4).ok, false);
  });
});

describe('lineRange — audited parity', () => {
  it('counts lines without a phantom trailing line', () => {
    assert.equal(countTotalLines(''), 0);
    assert.equal(countTotalLines('a'), 1);
    assert.equal(countTotalLines('a\n'), 1);
    assert.equal(countTotalLines('a\nb'), 2);
    assert.equal(countTotalLines('a\nb\n'), 2);
  });

  it('clamps the end but rejects a start past the file', () => {
    assert.deepEqual(computeLineRange(2, 99, 10), {
      ok: true,
      range: { startLine: 2, endLine: 10, totalLines: 10 },
    });
    assert.equal(computeLineRange(11, 12, 10).ok, false);
    assert.equal(computeLineRange(0, 2, 10).ok, false);
  });

  it('rejects any range for an empty file, defaults included', () => {
    assert.equal(computeLineRange(1, 1, 0).ok, false);
    assert.equal(computeLineRange(undefined, undefined, 0).ok, false);
  });

  it('preserves the NaN start_line behavior', () => {
    assert.equal(computeLineRange(Number.NaN, undefined, 10).ok, true);
  });

  it('runs only when a bound is supplied', () => {
    assert.equal(engine.validateLineRange(undefined, undefined, 0).ok, true);
    assert.equal(engine.validateLineRange(1, undefined, 0).ok, false);
    assert.equal(engine.validateLineRange(5, 3, 10).ok, false);
    assert.equal(engine.validateLineRange(1, 3, 10).ok, true);
  });

  it('slices with range semantics and keeps a trailing newline', () => {
    const content = 'a\nb\nc\n';
    const outcome = computeLineRange(2, 3, countTotalLines(content));

    assert.equal(outcome.ok, true);

    if (outcome.ok) {
      assert.equal(sliceLineRange(content, outcome.range), 'b\nc\n');
    }
  });
});
