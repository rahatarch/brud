import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { posix, win32 } from 'node:path';
import type {
  ValidationEnvironment,
  ValidationPolicy,
  ValidationWorkspacePort,
} from '../contracts/IValidationService.js';
import { isValidationFailure } from '../contracts/errors.js';
import type { ValidationDecision } from '../contracts/errors.js';
import { ALL_VALIDATION_RULES, VALIDATION_RULE_COUNT, ruleCategory } from '../contracts/rules.js';
import { ValidationService } from '../orchestrator/ValidationService.js';
import { KIND_CONSTRAINTS } from '../engine/kindMatrix.js';
import { legacyMessages } from '../engine/errorCatalog.js';
import { createStandardKernel } from '../../../src/bootstrap/index.js';
import { InMemoryStorageDriver } from '../../../drivers/memory/index.js';
import { ValidationToken } from '../descriptor/tokens.js';
import { WorkspaceToken } from '../../WorkspaceService/descriptor/tokens.js';
import { SettingsReaderToken } from '../../SettingsService/descriptor/tokens.js';

const ROOT = '/workspace';

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

/**
 * Workspace port double mirroring `WorkspaceService.resolve` semantics:
 * lexical rules, absolute routing, containment and A10 are all reproduced so
 * the orchestrator can be exercised without a real filesystem.
 */
function workspace(flavor: 'posix' | 'win32' = 'posix'): ValidationWorkspacePort {
  const api = flavor === 'win32' ? win32 : posix;
  const root = flavor === 'win32' ? 'C:\\workspace' : ROOT;

  return {
    roots: [root],
    primaryRoot: root,
    resolve: async (userPath: string) => {
      if (typeof userPath !== 'string') {
        throw Object.assign(new Error('not a string'), { code: 'WORKSPACE_PATH_VIOLATION', rule: 'INVALID_INPUT' });
      }

      if (userPath.includes('\0')) {
        throw Object.assign(new Error('null byte'), { code: 'WORKSPACE_PATH_VIOLATION', rule: 'NULL_BYTE' });
      }

      if (userPath.includes('..')) {
        throw Object.assign(new Error('outside'), { code: 'WORKSPACE_PATH_VIOLATION', rule: 'OUTSIDE_ROOT' });
      }

      if (userPath === '/etc/passwd' || userPath === '/outside') {
        throw Object.assign(new Error('sibling'), { code: 'WORKSPACE_PATH_VIOLATION', rule: 'SIBLING_PREFIX' });
      }

      if (userPath.includes('escape')) {
        throw Object.assign(new Error('symlink'), { code: 'WORKSPACE_PATH_VIOLATION', rule: 'SYMLINK_ESCAPE' });
      }

      const absolute = api.isAbsolute(userPath) ? api.resolve(userPath) : api.resolve(root, userPath);
      const relative = api.relative(root, absolute);

      return {
        root,
        absolutePath: absolute,
        relativePath: relative === '' ? '' : relative.split(api.sep).join('/'),
      };
    },
    toAbsolutePath: (kernelPath: string) => api.resolve(root, kernelPath),
  };
}

function service(options?: {
  readonly policy?: Partial<ValidationPolicy>;
  readonly flavor?: 'posix' | 'win32';
  readonly environment?: Partial<ValidationEnvironment>;
  readonly workspace?: ValidationWorkspacePort;
}): ValidationService {
  return new ValidationService({
    policy: policy(options?.policy),
    workspace: options?.workspace ?? workspace(options?.flavor),
    environment: {
      homeDirectory: options?.flavor === 'win32' ? 'C:\\Users\\dev' : '/home/dev',
      flavor: options?.flavor ?? 'posix',
      ...options?.environment,
    },
  });
}

function failure(decision: ValidationDecision): Extract<ValidationDecision, { readonly ok: false }> {
  assert.equal(isValidationFailure(decision), true, 'expected a failure decision');

  return decision as Extract<ValidationDecision, { readonly ok: false }>;
}

describe('ValidationService — rule catalogue', () => {
  it('catalogues exactly the 74 reconciled rules', () => {
    assert.equal(VALIDATION_RULE_COUNT, 74);
    assert.equal(ALL_VALIDATION_RULES.length, new Set(ALL_VALIDATION_RULES).size);
  });

  it('splits the catalogue 25 PATH / 11 CMD / 30 INPUT / 8 POLICY', () => {
    const counts = ALL_VALIDATION_RULES.reduce<Record<string, number>>((accumulator, rule) => {
      const category = ruleCategory(rule);
      accumulator[category] = (accumulator[category] ?? 0) + 1;

      return accumulator;
    }, {});

    assert.deepEqual(counts, { PATH: 25, CMD: 11, INPUT: 30, POLICY: 8 });
  });

  it('describes every rule with actionability and retryability', () => {
    const instance = service();

    for (const rule of ALL_VALIDATION_RULES) {
      const traits = instance.describeRule(rule);

      assert.equal(typeof traits.actionable, 'boolean', rule);
      assert.equal(typeof traits.retryable, 'boolean', rule);
    }
  });
});

describe('ValidationService — path decisions', () => {
  it('accepts a contained relative path', async () => {
    assert.deepEqual(await service().validatePath('notes/draft.md', 'read_file'), { ok: true });
  });

  it('accepts an absolute path inside the root', async () => {
    assert.deepEqual(await service().validatePath('/workspace/notes/draft.md', 'read_file'), { ok: true });
  });

  it('reports traversal with the legacy boundary code', async () => {
    const decision = failure(await service().validatePath('../secret.txt', 'read_file'));

    assert.equal(decision.code, 'PATH_TRAVERSAL_DETECTED');
    assert.equal(decision.rule, 'PATH.PARENT_SEGMENT');
    assert.equal(decision.legacyCode, 'PATH_OUTSIDE_WORKSPACE');
    assert.equal(decision.actionable, true);
    assert.equal(decision.retryable, false);
    assert.equal(decision.path, '../secret.txt');
    assert.equal(decision.operationKind, 'read_file');
  });

  it('reports null bytes as VALIDATION_ERROR at the boundary', async () => {
    const decision = failure(await service().validatePath('notes/\0x', 'read_file'));

    assert.equal(decision.rule, 'PATH.NULL_BYTE');
    assert.equal(decision.legacyCode, 'VALIDATION_ERROR');
  });

  it('reports sibling-prefix escapes as VALIDATION_ERROR (Appendix C row 3)', async () => {
    const decision = failure(await service().validatePath('/outside', 'read_file'));

    assert.equal(decision.rule, 'PATH.SIBLING_PREFIX');
    assert.equal(decision.code, 'PATH_TRAVERSAL_DETECTED');
    assert.equal(decision.legacyCode, 'VALIDATION_ERROR');
  });

  it('reports symlink escapes as PATH_OUTSIDE_WORKSPACE', async () => {
    const decision = failure(await service().validatePath('escape/secret.txt', 'read_file'));

    assert.equal(decision.rule, 'PATH.SYMLINK_ESCAPE');
    assert.equal(decision.legacyCode, 'PATH_OUTSIDE_WORKSPACE');
  });

  it('reports NO_WORKSPACE when the registry is empty', async () => {
    const decision = failure(await service({
      workspace: { roots: [], primaryRoot: '', resolve: async () => { throw new Error('unused'); }, toAbsolutePath: (path) => path },
    }).validatePath('a.ts', 'read_file'));

    assert.equal(decision.code, 'NO_WORKSPACE');
    assert.equal(decision.rule, 'PATH.NO_WORKSPACE');
    assert.equal(decision.legacyCode, 'NO_WORKSPACE');
  });

  it('rejects an unknown operation kind', async () => {
    const decision = failure(await service().validatePath('a.ts', 'nope'));

    assert.equal(decision.rule, 'PATH.NON_STRING');
    assert.equal(decision.legacyCode, 'VALIDATION_ERROR');
  });

  it('rejects the workspace root as a mutable target (V-3)', async () => {
    const decision = failure(await service().validatePath('', 'create_file'));

    assert.equal(decision.rule, 'PATH.ROOT_NOT_MUTABLE');
    assert.equal(decision.code, 'WORKSPACE_PATH_VIOLATION');
    assert.equal(decision.legacyCode, 'VALIDATION_ERROR');
  });

  it('allows the workspace root for reads', async () => {
    assert.deepEqual(await service().validatePath('', 'read_file'), { ok: true });
  });

  it('honours the frozen workspaceBoundaryEnabled=false policy for containment only', async () => {
    const uncontained = service({ policy: { workspaceBoundaryEnabled: false } });

    assert.deepEqual(await uncontained.validatePath('/outside', 'read_file'), { ok: true });

    const lexical = failure(await uncontained.validatePath('../escape', 'read_file'));
    assert.equal(lexical.rule, 'PATH.PARENT_SEGMENT');

    const nullByte = failure(await uncontained.validatePath('a\0b', 'read_file'));
    assert.equal(nullByte.rule, 'PATH.NULL_BYTE');
  });

  it('keeps lexical integrity unconditional even with the boundary disabled', async () => {
    const uncontained = service({ policy: { workspaceBoundaryEnabled: false }, flavor: 'win32' });

    assert.equal(failure(await uncontained.validatePath('CON', 'read_file')).rule, 'PATH.WIN_RESERVED_DEVICE');
    assert.equal(failure(await uncontained.validatePath('a.txt:s', 'read_file')).rule, 'PATH.WIN_ALT_DATA_STREAM');
  });

  it('does not throw for any invalid input', async () => {
    const inputs = ['', '.', '..', '../x', '/etc/passwd', 'a\0b', 'escape/x', '/outside', 'nul', 'a\\b'];

    for (const input of inputs) {
      const decision = await service().validatePath(input, 'read_file');

      assert.equal(typeof decision.ok, 'boolean');
    }
  });
});

describe('ValidationService — A10 across all kinds', () => {
  const protectedPaths = ['.brud/settings.json', '.brud/history/x', '.git/HEAD', '.git/config', '.brud/history'];

  for (const constraint of KIND_CONSTRAINTS) {
    if (constraint.access !== 'mutate' && constraint.access !== 'delete') {
      it(`${constraint.kind}: reads are allowed on protected paths`, async () => {
        for (const target of protectedPaths) {
          assert.deepEqual(await service().validatePath(target, constraint.kind), { ok: true }, target);
        }
      });

      continue;
    }

    it(`${constraint.kind}: every protected path is denied`, async () => {
      for (const target of protectedPaths) {
        const decision = failure(await service().validatePath(target, constraint.kind));

        assert.equal(decision.rule, 'PATH.PROTECTED_DENY', `${constraint.kind} ${target}`);
        assert.equal(decision.code, 'WORKSPACE_PATH_VIOLATION');
        assert.equal(decision.legacyCode, 'VALIDATION_ERROR');
      }
    });
  }

  it('covers directory creation and deletion, which the legacy filesystem missed', async () => {
    for (const kind of ['create_directory', 'delete_directory', 'move_directory']) {
      assert.equal(failure(await service().validatePath('.brud/history', kind)).rule, 'PATH.PROTECTED_DENY');
      assert.equal(failure(await service().validatePath('.git', kind)).rule, 'PATH.PROTECTED_DENY');
    }
  });

  it('allows ordinary mutations', async () => {
    for (const kind of ['create_file', 'delete_file', 'create_directory', 'delete_directory']) {
      assert.deepEqual(await service().validatePath('src/index.ts', kind), { ok: true }, kind);
    }
  });

  it('still applies containment before the denylist', async () => {
    assert.equal(
      failure(await service().validatePath('../.git/config', 'create_file')).rule,
      'PATH.PARENT_SEGMENT',
    );
  });
});

describe('ValidationService — commands', () => {
  it('blocks dangerous commands with the legacy text and rule', () => {
    const decision = failure(service().validateCommand('rm -rf /'));

    assert.equal(decision.code, 'DANGEROUS_COMMAND');
    assert.equal(decision.rule, 'CMD.RM_ROOT');
    assert.equal(decision.legacyCode, 'DANGEROUS_COMMAND');
    assert.equal(decision.friendly, 'The command is potentially dangerous and has been blocked.');
    assert.equal(decision.metadata?.['patternIndex'], 0);
  });

  it('blocks the nine audited bypasses', () => {
    const bypasses = [
      'rm -r -f /',
      'rm --recursive --force /',
      'echo cm0gLXJmIC8= | base64 -d | sh',
      'find . -name x -exec rm -rf {} +',
      'xargs rm -rf',
      'printf \':(){ :|:& };:\' | bash',
      'chmod 777 -R /',
      'SUDO apt install',
      'command cd /outside',
    ];

    for (const command of bypasses) {
      assert.equal(failure(service().validateCommand(command)).code === 'DANGEROUS_COMMAND'
        || failure(service().validateCommand(command)).code === 'CWD_ESCAPE', true, command);
    }
  });

  it('allows safe commands', () => {
    for (const command of ['npm test', 'git status', 'rm -rf ./dist']) {
      assert.deepEqual(service().validateCommand(command), { ok: true }, command);
    }
  });

  it('returns MISSING_FIELD for a non-string command', () => {
    const decision = failure(service().validateCommand(null as unknown as string));

    assert.equal(decision.code, 'MISSING_FIELD');
    assert.equal(decision.rule, 'CMD.NO_COMMAND');
  });

  it('maps a workspace configuration failure to NO_WORKSPACE at the boundary', async () => {
    const broken: ValidationWorkspacePort = {
      roots: ['/workspace'],
      primaryRoot: '/workspace',
      resolve: async () => {
        throw Object.assign(new Error('bad root'), {
          code: 'WORKSPACE_CONFIGURATION_INVALID',
          rule: 'INVALID_INPUT',
          reason: 'the root registry is unusable',
        });
      },
      toAbsolutePath: (path) => path,
    };

    const decision = failure(await service({ workspace: broken }).validatePath('a.ts', 'read_file'));

    assert.equal(decision.code, 'WORKSPACE_CONFIGURATION_INVALID');
    assert.equal(decision.legacyCode, 'NO_WORKSPACE');
  });

  it('returns MISSING_FIELD for an empty command', () => {
    const decision = failure(service().validateCommand('   '));

    assert.equal(decision.code, 'MISSING_FIELD');
    assert.equal(decision.rule, 'CMD.NO_COMMAND');
  });

  it('reports CWD_ESCAPE and DYNAMIC_PATH', () => {
    const escape = failure(service().validateCommand('cd /outside && ls'));

    assert.equal(escape.code, 'CWD_ESCAPE');
    assert.equal(escape.rule, 'PATH.CWD_ESCAPE');
    assert.equal(escape.legacyCode, 'CWD_ESCAPE');

    const dynamic = failure(service().validateCommand('cd $VAR && ls'));

    assert.equal(dynamic.code, 'DYNAMIC_PATH');
    assert.equal(dynamic.rule, 'PATH.CWD_DYNAMIC');
  });

  it('rejects an invalid explicit cwd', () => {
    const decision = failure(service().validateCommand('ls', '/outside'));

    assert.equal(decision.code, 'INVALID_CWD');
    assert.equal(decision.rule, 'PATH.CWD_INVALID');
  });

  it('reports NO_WORKSPACE only when a cd chain has no workspace to be contained in', () => {
    const unconfigured = service({
      workspace: { roots: [], primaryRoot: '', resolve: async () => { throw new Error('unused'); }, toAbsolutePath: (path) => path },
    });

    assert.equal(failure(unconfigured.validateCommand('cd /outside && ls')).code, 'NO_WORKSPACE');
    assert.deepEqual(unconfigured.validateCommand('ls'), { ok: true });
    assert.equal(failure(unconfigured.validateCommand('sudo rm -rf /')).code, 'DANGEROUS_COMMAND');
  });

  it('supports the synchronous legacy boundary', () => {
    const instance = service();

    assert.deepEqual(instance.validatePathSync('notes/draft.md', 'read_file'), { ok: true });
    assert.equal(failure(instance.validatePathSync('../x', 'read_file')).rule, 'PATH.PARENT_SEGMENT');
    assert.equal(failure(instance.validatePathSync('.git/HEAD', 'create_file')).rule, 'PATH.PROTECTED_DENY');
    assert.equal(failure(instance.validatePathSync('/outside', 'read_file')).rule, 'PATH.OUTSIDE_ROOT');
    assert.equal(failure(instance.validatePathSync('', 'delete_file')).rule, 'PATH.ROOT_NOT_MUTABLE');
  });

  it('skips command rules but not cd containment when commandValidationEnabled=false', () => {
    const relaxed = service({ policy: { commandValidationEnabled: false } });

    assert.deepEqual(relaxed.validateCommand('rm -rf /'), { ok: true });
    assert.equal(failure(relaxed.validateCommand('cd /outside')).code, 'CWD_ESCAPE');
  });

  it('skips cd containment when workspaceBoundaryEnabled=false', () => {
    const uncontained = service({ policy: { workspaceBoundaryEnabled: false } });

    assert.deepEqual(uncontained.validateCommand('cd /outside'), { ok: true });
    assert.equal(failure(uncontained.validateCommand('sudo rm -rf /')).code, 'DANGEROUS_COMMAND');
  });

  it('uses the injected win32 flavor for cd resolution', () => {
    const win = service({ flavor: 'win32' });

    assert.equal(failure(win.validateCommand('cd C:\\outside')).code, 'CWD_ESCAPE');
    assert.deepEqual(win.validateCommand('cd C:\\workspace\\src'), { ok: true });
  });

  it('has no per-call policy override surface', () => {
    const instance = service() as unknown as Record<string, unknown>;

    assert.equal(typeof instance['validateCommandWithOptions'], 'undefined');
    assert.equal(
      (instance['validateCommand'] as (command: string, cwd?: string, options?: unknown) => unknown).length,
      2,
    );
  });
});

describe('ValidationService — inputs', () => {
  it('accepts a valid payload for every kind', async () => {
    const payloads: Readonly<Record<string, unknown>> = {
      create_file: { path: 'a.ts', content: 'x', index: '1' },
      read_file: { path: 'a.ts', index: '1' },
      terminal_command: { command: 'ls', index: '1' },
      terminal_interactive: { command: 'ls', answers: [], index: '1' },
      get_tool_info: { index: '1' },
    };

    for (const [kind, input] of Object.entries(payloads)) {
      assert.deepEqual(service().validateInput(kind, input), { ok: true }, kind);
    }
  });

  it('reports UNKNOWN_OPERATION', () => {
    const decision = failure(service().validateInput('nope', {}));

    assert.equal(decision.code, 'UNKNOWN_OPERATION');
    assert.equal(decision.rule, 'INPUT.UNKNOWN_OPERATION');
  });

  it('reports TOOL_DISABLED from the frozen allowlist', () => {
    const decision = failure(service({ policy: { toolAllowList: { create_file: false } } })
      .validateInput('create_file', { path: 'a', content: 'x', index: '1' }));

    assert.equal(decision.code, 'TOOL_DISABLED');
    assert.equal(decision.rule, 'INPUT.TOOL_DISABLED');
  });

  it('reports MISSING_INDEX and MISSING_FIELD', () => {
    assert.equal(failure(service().validateInput('create_file', { path: 'a', content: 'x' })).code, 'MISSING_INDEX');
    assert.equal(failure(service().validateInput('create_file', { content: 'x', index: '1' })).code, 'MISSING_FIELD');
  });

  it('reports INVALID_FIELD for position and mode', () => {
    assert.equal(
      failure(service().validateInput('append_file', { path: 'a', content: '', index: '1', position: 'top' })).code,
      'INVALID_FIELD',
    );
    assert.equal(
      failure(service().validateInput('terminal_command', { command: 'ls', index: '1', mode: 'x' })).code,
      'INVALID_FIELD',
    );
  });

  it('reports MISSING_FIELD for empty patterns and non-array answers', () => {
    assert.equal(failure(service().validateInput('search_files', { patterns: [], index: '1' })).code, 'MISSING_FIELD');
    assert.equal(
      failure(service().validateInput('terminal_interactive', { command: 'ls', answers: 'y', index: '1' })).code,
      'MISSING_FIELD',
    );
  });

  it('reports MISSING_FIELD when terminal_command has neither command nor commands', () => {
    const decision = failure(service().validateInput('terminal_command', { index: '1' }));

    assert.equal(decision.code, 'MISSING_FIELD');
    assert.equal(decision.rule, 'CMD.NO_COMMAND');
  });

  it('validates a read batch against the frozen ceiling', () => {
    assert.deepEqual(service().validateBatch(100), { ok: true });

    const decision = failure(service().validateBatch(101));

    assert.equal(decision.code, 'BATCH_LIMIT_EXCEEDED');
    assert.equal(decision.rule, 'INPUT.BATCH_LIMIT');
    assert.equal(decision.actionable, true);
    assert.equal(decision.retryable, true);
  });

  it('emits POLICY.AGGREGATE_BYTES when the aggregate budget is exceeded', () => {
    const decision = failure(service().validateBatch(2, 9 * 1024 * 1024));

    assert.equal(decision.code, 'BATCH_LIMIT_EXCEEDED');
    assert.equal(decision.rule, 'POLICY.AGGREGATE_BYTES');
    assert.equal(decision.legacyCode, 'BATCH_LIMIT_EXCEEDED');
    assert.equal(decision.actionable, true);
    assert.equal(decision.retryable, true);
  });

  it('admits a batch inside both ceilings', () => {
    assert.deepEqual(service().validateBatch(2, 1024), { ok: true });
  });

  it('keeps the file ceiling verdict when both ceilings are exceeded', () => {
    const decision = failure(service().validateBatch(101, 9 * 1024 * 1024));

    assert.equal(decision.rule, 'INPUT.BATCH_LIMIT');
  });

  it('exempts import reads from the aggregate budget', () => {
    assert.deepEqual(service().validateBatch(2, 9 * 1024 * 1024, true), { ok: true });
  });

  it('emits INPUT.READ_ONLY_PROJECTION for a mutation on a read-only projection', () => {
    const decision = failure(service().validateReadOnlyProjection('createFile', '.brud/work/a.json'));

    assert.equal(decision.code, 'READ_ONLY_VIOLATION');
    assert.equal(decision.rule, 'INPUT.READ_ONLY_PROJECTION');
    assert.equal(decision.legacyCode, 'VALIDATION_ERROR');
    assert.equal(decision.actionable, false);
    assert.equal(decision.retryable, false);
  });

  it('validates a path-bearing field end-to-end', async () => {
    assert.deepEqual(
      await service().validateOperationPath('create_file', { path: 'src/a.ts', content: 'x', index: '1' }, 'path'),
      { ok: true },
    );

    const decision = failure(await service().validateOperationPath(
      'create_file',
      { path: '.brud/settings.json', content: 'x', index: '1' },
      'path',
    ));

    assert.equal(decision.rule, 'PATH.PROTECTED_DENY');
  });
});

describe('ValidationService — membership pre-checks (F-1 / F-2)', () => {
  it('accepts a catalogued kind without inspecting its payload', () => {
    assert.deepEqual(service().validateKnownOperation('read_file'), { ok: true });
    assert.deepEqual(service().validateKnownTool('read_file'), { ok: true });
  });

  it('reports UNKNOWN_OPERATION for an unknown kind', () => {
    const decision = failure(service().validateKnownOperation('bogus_operation'));

    assert.equal(decision.rule, 'INPUT.UNKNOWN_OPERATION');
    assert.equal(decision.legacyCode, 'UNKNOWN_OPERATION');
  });

  it('reports TOOL_NOT_FOUND for an unknown tool', () => {
    const decision = failure(service().validateKnownTool('bogus_tool'));

    assert.equal(decision.rule, 'INPUT.UNKNOWN_TOOL');
    assert.equal(decision.code, 'TOOL_NOT_FOUND');
    assert.equal(decision.legacyCode, 'TOOL_NOT_FOUND');
  });
});

describe('ValidationService — metadata member checks (F-3)', () => {
  it('maps every metadata rule onto its legacy E_* code', () => {
    const cases = [
      ['INPUT.METADATA_WRONG_CASE', { wrapper: 'SESSION_METADATA' }, 'E_METADATA_WRONG_CASE'],
      ['INPUT.DUPLICATE_SESSION_METADATA', {}, 'E_DUPLICATE_SESSION_METADATA'],
      ['INPUT.DUPLICATE_OPERATION_METADATA', { index: '2' }, 'E_DUPLICATE_OPERATION_METADATA'],
      ['INPUT.METADATA_FIELD_CASE', { field: 'Title:' }, 'E_METADATA_FIELD_CASE'],
      ['INPUT.METADATA_UNKNOWN_FIELD', { field: 'author:' }, 'E_METADATA_UNKNOWN_FIELD'],
      ['INPUT.SESSION_METADATA_POSITION', {}, 'E_SESSION_METADATA_POSITION'],
      ['INPUT.OPERATION_METADATA_POSITION', { index: '3' }, 'E_OPERATION_METADATA_POSITION'],
      ['INPUT.METADATA_UNCLOSED', { wrapper: 'session_metadata' }, 'E_METADATA_UNCLOSED'],
    ] as const;

    for (const [rule, values, code] of cases) {
      const decision = failure(service().validateMetadata(rule, values));

      assert.equal(decision.rule, rule);
      assert.equal(decision.code, code);
      assert.equal(decision.legacyCode, code);
    }
  });

  it('renders the legacy unclosed-wrapper text', () => {
    const decision = failure(service().validateMetadata('INPUT.METADATA_UNCLOSED', { wrapper: 'session_metadata' }));

    assert.equal(decision.friendly, 'Unclosed <session_metadata> wrapper. Expected </session_metadata>.');
    assert.equal(decision.details, 'Unclosed <session_metadata> wrapper. Expected </session_metadata>.');
  });

  it('renders the legacy duplicate-operation text with the index', () => {
    const decision = failure(service().validateMetadata('INPUT.DUPLICATE_OPERATION_METADATA', { index: '4' }));

    assert.equal(
      decision.friendly,
      "Duplicate operation metadata block in operation '4'.",
    );
  });
});

describe('ValidationService — lifecycle and frozen policy', () => {
  it('exposes the frozen boot policy', () => {
    const instance = service({ policy: { commandValidationEnabled: false } });

    assert.equal(instance.getPolicy().commandValidationEnabled, false);
    assert.equal(Object.isFrozen(instance.getPolicy()), true);
  });

  it('reports the policy at the boundary', () => {
    const instance = service();

    assert.equal(instance.getPolicy().workspaceBoundaryEnabled, true);
    assert.equal(instance.getPolicy().readMaxBatchFiles, 100);
  });

  it('is idempotent for initialize/dispose', async () => {
    const instance = service();

    await instance.initialize();
    await instance.dispose();
  });

  it('never mutates policy across a sequence of calls', async () => {
    const instance = service();

    await instance.validatePath('a.ts', 'read_file');
    instance.validateCommand('ls');
    instance.validateInput('read_file', { path: 'a.ts', index: '1' });

    assert.equal(instance.getPolicy().workspaceBoundaryEnabled, true);
    assert.equal(Object.isFrozen(instance.getPolicy().toolAllowList), true);
  });
});

describe('ValidationService — remaining decision entry points', () => {
  it('validates an operation batch envelope', () => {
    assert.deepEqual(service().validateOperations([{ kind: 'read_file' }]), { ok: true });
    assert.equal(failure(service().validateOperations([])).code, 'NO_VALID_OPERATIONS');
    assert.equal(failure(service().validateOperations([{ kind: 'nope' }])).code, 'UNKNOWN_OPERATION');
  });

  it('validates extract operations', () => {
    assert.deepEqual(service().validateExtractOperations([{ kind: 'extract_structure' }]), { ok: true });
    assert.equal(failure(service().validateExtractOperations([{ kind: 'read_file' }])).code, 'NO_EXTRACT_OPERATIONS');
  });

  it('validates the block format', () => {
    const message = '<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE';

    assert.deepEqual(service().validateFormat(message), { ok: true });
    assert.equal(failure(service().validateFormat('nope')).code, 'PARSE_ERROR');
  });

  it('validates preview eligibility', () => {
    assert.deepEqual(service().validatePreview('create_file', [{}]), { ok: true });
    assert.equal(failure(service().validatePreview('read_file', [{}])).code, 'PREVIEW_NOT_AVAILABLE');
    assert.equal(failure(service().validatePreview('create_file', [])).code, 'NO_PREVIEW');
  });

  it('validates single matches', () => {
    assert.deepEqual(service().validateSingleMatch('a.ts', 'foo', 'foo'), { ok: true });
    assert.equal(failure(service().validateSingleMatch('a.ts', 'bar', 'foo')).code, 'SEARCH_NOT_FOUND');
    assert.equal(failure(service().validateSingleMatch('a.ts', 'foo foo', 'foo')).code, 'MULTIPLE_MATCHES');
  });

  it('validates a line range', () => {
    assert.deepEqual(service().validateLineRangeSync(1, 2, 10), { ok: true });

    const decision = failure(service().validateLineRangeSync(20, 30, 10));

    assert.equal(decision.code, 'INVALID_LINE_RANGE');
    assert.equal(decision.rule, 'INPUT.LINE_RANGE');
  });

  it('validates sessions and revert requests', () => {
    assert.deepEqual(service().validateSession('s1', { id: 's1' }), { ok: true });
    assert.equal(failure(service().validateSession('s1', undefined)).code, 'SESSION_NOT_FOUND');
    assert.deepEqual(service().validateRevertRequest('s1', 'state'), { ok: true });
    assert.equal(failure(service().validateRevertRequest(undefined, 'state')).code, 'INVALID_REVERT_REQUEST');
  });

  it('validates target kind for writes and deletes', () => {
    assert.deepEqual(service().validateTargetKind('create_file', 'file'), { ok: true });
    assert.equal(failure(service().validateTargetKind('create_file', 'directory')).code, 'CANNOT_WRITE_DIRECTORY');
    assert.equal(failure(service().validateTargetKind('delete_file', 'directory')).code, 'CANNOT_DELETE_DIRECTORY');
  });

  it('pins a new boot policy after construction', async () => {
    const instance = service();

    await instance.pinBootPolicy({
      policy: policy({ workspaceBoundaryEnabled: false, readMaxBatchFiles: 5 }),
      workspace: workspace(),
    });

    assert.equal(instance.getPolicy().workspaceBoundaryEnabled, false);
    assert.equal(instance.getPolicy().readMaxBatchFiles, 5);
    assert.equal(failure(instance.validateBatch(6)).code, 'BATCH_LIMIT_EXCEEDED');
  });
});

describe('errorCatalog — legacy message parity', () => {
  it('reproduces the audited friendly strings verbatim', () => {
    assert.equal(legacyMessages('NO_WORKSPACE').friendly, 'No workspace is currently open.');
    assert.equal(legacyMessages('MISSING_INDEX').friendly, 'You haven\'t used any index number with your instructions.');
    assert.equal(legacyMessages('INVALID_LINE_RANGE').friendly, 'Invalid line range specified for file read.');
    assert.equal(legacyMessages('BATCH_LIMIT_EXCEEDED').friendly, 'Read batch too large.');
    assert.equal(legacyMessages('TOOL_DISABLED', { operation: 'x' }).friendly, 'Tool "x" is disabled.');
  });

  it('interpolates legacy detail templates', () => {
    assert.equal(
      legacyMessages('PATH_TRAVERSAL_DETECTED', { path: '/etc/passwd' }).details,
      'The path "/etc/passwd" is outside the current workspace. File operations are restricted to files and folders inside the workspace.',
    );
    assert.equal(
      legacyMessages('MISSING_FIELD', { field: 'path', operation: 'replace' }).details,
      'The field "path" is required in replace operation.',
    );
    assert.equal(
      legacyMessages('INVALID_LINE_RANGE', { startLine: 5, endLine: 3, totalLines: 4 }).details,
      'Requested line range 5-3 is invalid for file with 4 lines (1-indexed).',
    );
    assert.equal(
      legacyMessages('BATCH_LIMIT_EXCEEDED', { requested: 101, limit: 100 }).details,
      'Requested 101 files; the limit is 100 per batch. Narrow the pattern, add excludePatterns, or split the read into sequential batches of 100 or fewer.',
    );
  });

  it('keeps UNEXPECTED_ERROR rather than the plan\'s EXECUTION_ERROR (audit §6.2)', () => {
    assert.equal(legacyMessages('UNEXPECTED_ERROR', { operation: 'write', reason: 'boom' }).friendly, 'An unexpected error occurred.');
  });
});

describe('ValidationService — standard kernel registration', () => {
  it('registers after workspace and before history, with both dependencies', async () => {
    const kernel = createStandardKernel({
      storageDriver: new InMemoryStorageDriver(),
      history: { inMemory: true },
    });

    await kernel.boot({ workspaceRoot: '/workspace' });

    try {
      const ids = kernel.listServices().map((entry) => entry.id);

      assert.ok(ids.includes('brud.core.validation'));
      assert.ok(ids.indexOf('brud.core.validation') > ids.indexOf('brud.core.workspace'));
      assert.ok(ids.indexOf('brud.core.validation') > ids.indexOf('brud.core.settings'));
      assert.ok(ids.indexOf('brud.core.validation') < ids.indexOf('brud.core.history'));

      const validation = kernel.requestAccess(
        { callerId: 'test.runner', tier: 'core', workspaceRoot: '/workspace' },
        ValidationToken,
      );

      assert.equal(validation.getPolicy().workspaceBoundaryEnabled, true);
      assert.equal(validation.getPolicy().commandValidationEnabled, true);
      assert.equal(Object.isFrozen(validation.getPolicy()), true);

      const workspace = kernel.requestAccess(
        { callerId: 'test.runner', tier: 'core', workspaceRoot: '/workspace' },
        WorkspaceToken,
      );
      const settings = kernel.requestAccess(
        { callerId: 'test.runner', tier: 'core', workspaceRoot: '/workspace' },
        SettingsReaderToken,
      );

      assert.equal(validation.getPolicy().readMaxBatchFiles, settings.getSnapshot().readMaxBatchFiles);
      assert.equal(validation.getPolicy().workspaceBoundaryEnabled, settings.getSnapshot().workspaceBoundaryEnabled);
      assert.equal(workspace.primaryRoot, '/workspace');

      assert.deepEqual(await validation.validatePath('src/a.ts', 'read_file'), { ok: true });

      const escape = await validation.validatePath('../escape', 'read_file');
      assert.equal(escape.ok, false);
      assert.equal(escape.ok ? null : escape.rule, 'PATH.PARENT_SEGMENT');
      assert.equal(escape.ok ? null : escape.code, 'PATH_TRAVERSAL_DETECTED');
      assert.equal(validation.validateCommand('sudo rm -rf /').ok, false);
    } finally {
      await kernel.shutdown();
    }
  });
});
