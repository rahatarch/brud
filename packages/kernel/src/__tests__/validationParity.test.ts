import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  ALL_VALIDATION_RULES,
  DEFAULT_READ_CONCURRENCY as KERNEL_DEFAULT_READ_CONCURRENCY,
  DEFAULT_READ_MAX_AGGREGATE_BYTES,
  DEFAULT_READ_MAX_BATCH_FILES,
  KERNEL_HARD_MAX_AGGREGATE_BYTES,
  KERNEL_MAX_BATCH_FILES,
  METADATA_RULE_CODES,
  READ_CONCURRENCY_MAX,
  READ_MAX_AGGREGATE_BYTES_MAX,
  READ_MAX_BATCH_FILES_MAX,
  VALIDATION_RULE_COUNT,
  ruleCategory,
} from '../index.js';
import type { MetadataRule } from '../index.js';
import { KIND_CONSTRAINTS, KNOWN_OPERATION_KINDS, KNOWN_TOOL_KINDS } from '../index.js';
import { DEFAULT_SETTINGS as KERNEL_DEFAULT_SETTINGS } from '../../services/SettingsService/model/defaults.js';

/**
 * Core's governor values, measured at runtime rather than imported.
 *
 * `@brud/core` compiles to CommonJS and is not a kernel dependency, so a
 * type-level import would drag a foreign rootDir into this program. Loading the
 * module through `require` observes the constants exactly as the legacy reader
 * observes them, which is what parity is about.
 */
const requireCore = createRequire(import.meta.url);
const CORE_SETTINGS = requireCore('../../../core/src/settings/types.ts') as {
  readonly MAX_BATCH_FILES: number;
  readonly MAX_AGGREGATE_BYTES: number;
  readonly HARD_MAX_AGGREGATE_BYTES: number;
  readonly MAX_READ_CONCURRENCY: number;
  readonly DEFAULT_READ_CONCURRENCY: number;
  readonly DEFAULT_SETTINGS: {
    readonly readMaxBatchFiles?: number;
    readonly readMaxAggregateBytes?: number;
    readonly readConcurrency?: number;
  };
};
const CORE_MAX_BATCH_FILES = CORE_SETTINGS.MAX_BATCH_FILES;
const CORE_MAX_AGGREGATE_BYTES = CORE_SETTINGS.MAX_AGGREGATE_BYTES;
const CORE_HARD_MAX_AGGREGATE_BYTES = CORE_SETTINGS.HARD_MAX_AGGREGATE_BYTES;
const CORE_MAX_READ_CONCURRENCY = CORE_SETTINGS.MAX_READ_CONCURRENCY;
const CORE_DEFAULT_READ_CONCURRENCY = CORE_SETTINGS.DEFAULT_READ_CONCURRENCY;
const CORE_DEFAULT_SETTINGS = CORE_SETTINGS.DEFAULT_SETTINGS;

/** Core's raw literals, as they read before R-6 derived them from the kernel. */
const PRE_R6_CORE_LITERALS = Object.freeze({
  MAX_BATCH_FILES: 100,
  MAX_AGGREGATE_BYTES: 8 * 1024 * 1024,
  HARD_MAX_AGGREGATE_BYTES: 32 * 1024 * 1024,
  MAX_READ_CONCURRENCY: 32,
  DEFAULT_READ_CONCURRENCY: 16,
});

/**
 * Legacy kind literal, copied from `git show HEAD:packages/core/src/api/index.ts`
 * (`KNOWN_OPERATIONS`, lines 125-147) before the Phase 3 facade deleted it.
 * `KNOWN_TOOLS` was byte-identical, so one literal pins both (audit F-7).
 */
const LEGACY_KNOWN_OPERATIONS = [
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
] as const;

/** Legacy `E_*` metadata codes plus their `INPUT.*` rule owners (audit §2.3). */
const LEGACY_METADATA_CODES: Readonly<Record<MetadataRule, string>> = {
  'INPUT.METADATA_WRONG_CASE': 'E_METADATA_WRONG_CASE',
  'INPUT.DUPLICATE_SESSION_METADATA': 'E_DUPLICATE_SESSION_METADATA',
  'INPUT.DUPLICATE_OPERATION_METADATA': 'E_DUPLICATE_OPERATION_METADATA',
  'INPUT.METADATA_FIELD_CASE': 'E_METADATA_FIELD_CASE',
  'INPUT.METADATA_UNKNOWN_FIELD': 'E_METADATA_UNKNOWN_FIELD',
  'INPUT.SESSION_METADATA_POSITION': 'E_SESSION_METADATA_POSITION',
  'INPUT.OPERATION_METADATA_POSITION': 'E_OPERATION_METADATA_POSITION',
  'INPUT.METADATA_UNCLOSED': 'E_METADATA_UNCLOSED',
};

describe('W-9 — 21-kind parity matrix', () => {
  it('matches the legacy KNOWN_OPERATIONS set exactly', () => {
    assert.deepEqual(new Set(KNOWN_OPERATION_KINDS), new Set(LEGACY_KNOWN_OPERATIONS));
  });

  it('matches the legacy KNOWN_OPERATIONS order exactly', () => {
    assert.deepEqual([...KNOWN_OPERATION_KINDS], [...LEGACY_KNOWN_OPERATIONS]);
  });

  it('exposes the same vocabulary as KNOWN_TOOL_KINDS', () => {
    assert.deepEqual([...KNOWN_TOOL_KINDS], [...LEGACY_KNOWN_OPERATIONS]);
  });

  it('has one constraint per legacy kind with no duplicates', () => {
    const kinds = KIND_CONSTRAINTS.map((constraint) => constraint.kind);

    assert.equal(kinds.length, LEGACY_KNOWN_OPERATIONS.length);
    assert.equal(new Set(kinds).size, kinds.length);
  });

  it('never mentions a kind outside the legacy literal', () => {
    for (const constraint of KIND_CONSTRAINTS) {
      assert.ok(
        (LEGACY_KNOWN_OPERATIONS as readonly string[]).includes(constraint.kind),
        `${constraint.kind} is not a legacy kind`,
      );
    }
  });
});

describe('W-9 — rule catalogue reconciliation', () => {
  it('reports the count the category split implies', () => {
    const counts = ALL_VALIDATION_RULES.reduce<Record<string, number>>((accumulator, rule) => {
      const category = ruleCategory(rule);
      accumulator[category] = (accumulator[category] ?? 0) + 1;

      return accumulator;
    }, {});

    assert.equal(VALIDATION_RULE_COUNT, ALL_VALIDATION_RULES.length);
    assert.deepEqual(counts, { PATH: 25, CMD: 11, INPUT: 30, POLICY: 8 });
  });

  it('retires the dead CMD.CD_* aliases', () => {
    for (const rule of ALL_VALIDATION_RULES) {
      assert.notEqual(rule, 'CMD.CD_ESCAPE');
      assert.notEqual(rule, 'CMD.CD_DYNAMIC');
    }
  });

  it('catalogues POLICY.READ_CONCURRENCY as a rule (F-5)', () => {
    assert.ok(ALL_VALIDATION_RULES.includes('POLICY.READ_CONCURRENCY'));
  });

  it('splits the metadata family into the eight audited rules (F-3)', () => {
    const inputRules = ALL_VALIDATION_RULES.filter((rule) => ruleCategory(rule) === 'INPUT');
    const metadataRules = inputRules.filter((rule) => (rule as string) in LEGACY_METADATA_CODES);

    assert.deepEqual(new Set(metadataRules), new Set(Object.keys(LEGACY_METADATA_CODES)));
    assert.equal(metadataRules.length, 8);
    assert.ok(!ALL_VALIDATION_RULES.includes('INPUT.METADATA_INVALID' as never));
  });

  it('maps every metadata rule onto its legacy E_* code', () => {
    for (const [rule, code] of Object.entries(LEGACY_METADATA_CODES)) {
      assert.equal(METADATA_RULE_CODES[rule as MetadataRule], code, rule);
    }
  });

  it('keeps INPUT.UNKNOWN_TOOL in the vocabulary with a boundary mapping', () => {
    assert.ok(ALL_VALIDATION_RULES.includes('INPUT.UNKNOWN_TOOL'));
  });
});

describe('R-6 — batch ceiling parity between core and kernel', () => {
  it('derives the core batch ceiling from the kernel settings ceiling', () => {
    assert.equal(CORE_MAX_BATCH_FILES, KERNEL_MAX_BATCH_FILES);
    assert.equal(KERNEL_MAX_BATCH_FILES, READ_MAX_BATCH_FILES_MAX);
  });

  it('derives the core hard aggregate ceiling from the kernel settings ceiling', () => {
    assert.equal(CORE_HARD_MAX_AGGREGATE_BYTES, KERNEL_HARD_MAX_AGGREGATE_BYTES);
    assert.equal(KERNEL_HARD_MAX_AGGREGATE_BYTES, READ_MAX_AGGREGATE_BYTES_MAX);
  });

  it('derives the core aggregate budget from the kernel default', () => {
    assert.equal(CORE_MAX_AGGREGATE_BYTES, DEFAULT_READ_MAX_AGGREGATE_BYTES);
  });

  it('derives the core concurrency values from the kernel', () => {
    assert.equal(CORE_MAX_READ_CONCURRENCY, READ_CONCURRENCY_MAX);
    assert.equal(CORE_DEFAULT_READ_CONCURRENCY, KERNEL_DEFAULT_READ_CONCURRENCY);
  });

  it('keeps the core settings defaults inside the kernel ceilings', () => {
    assert.equal(CORE_DEFAULT_SETTINGS.readMaxBatchFiles, KERNEL_MAX_BATCH_FILES);
    assert.equal(CORE_DEFAULT_SETTINGS.readMaxAggregateBytes, DEFAULT_READ_MAX_AGGREGATE_BYTES);
    assert.equal(CORE_DEFAULT_SETTINGS.readConcurrency, KERNEL_DEFAULT_READ_CONCURRENCY);
    assert.equal(CORE_DEFAULT_SETTINGS.readMaxBatchFiles, KERNEL_DEFAULT_SETTINGS.readMaxBatchFiles);
    assert.equal(CORE_DEFAULT_SETTINGS.readMaxAggregateBytes, KERNEL_DEFAULT_SETTINGS.readMaxAggregateBytes);
    assert.equal(CORE_DEFAULT_SETTINGS.readConcurrency, KERNEL_DEFAULT_SETTINGS.readConcurrency);
    assert.ok(CORE_DEFAULT_SETTINGS.readMaxBatchFiles! <= KERNEL_MAX_BATCH_FILES);
    assert.ok(CORE_DEFAULT_SETTINGS.readMaxAggregateBytes! <= KERNEL_HARD_MAX_AGGREGATE_BYTES);
  });

  it('pins the ratified ceiling values', () => {
    assert.equal(KERNEL_MAX_BATCH_FILES, 100);
    assert.equal(DEFAULT_READ_MAX_BATCH_FILES, 100);
    assert.equal(KERNEL_HARD_MAX_AGGREGATE_BYTES, 32 * 1024 * 1024);
    assert.equal(DEFAULT_READ_MAX_AGGREGATE_BYTES, 8 * 1024 * 1024);
  });

  it('keeps every core constant equal to its kernel source value', () => {
    const core: Readonly<Record<string, number>> = {
      MAX_BATCH_FILES: CORE_MAX_BATCH_FILES,
      MAX_AGGREGATE_BYTES: CORE_MAX_AGGREGATE_BYTES,
      HARD_MAX_AGGREGATE_BYTES: CORE_HARD_MAX_AGGREGATE_BYTES,
      MAX_READ_CONCURRENCY: CORE_MAX_READ_CONCURRENCY,
      DEFAULT_READ_CONCURRENCY: CORE_DEFAULT_READ_CONCURRENCY,
    };
    const kernel: Readonly<Record<string, number>> = {
      MAX_BATCH_FILES: KERNEL_MAX_BATCH_FILES,
      MAX_AGGREGATE_BYTES: DEFAULT_READ_MAX_AGGREGATE_BYTES,
      HARD_MAX_AGGREGATE_BYTES: KERNEL_HARD_MAX_AGGREGATE_BYTES,
      MAX_READ_CONCURRENCY: READ_CONCURRENCY_MAX,
      DEFAULT_READ_CONCURRENCY: KERNEL_DEFAULT_READ_CONCURRENCY,
    };

    assert.deepEqual(core, kernel);
    assert.deepEqual(core, PRE_R6_CORE_LITERALS);
  });
});
