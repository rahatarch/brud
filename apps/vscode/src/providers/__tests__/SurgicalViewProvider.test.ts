import { describe, it } from 'node:test';
import assert from 'node:assert';

interface OperationResult {
  operationId: string;
  operationIndex: number;
  kind: string;
  status: 'success' | 'aborted' | 'failed';
  message: string;
  path: string;
  data?: { command: string; output: string; exitCode: number | null; duration: number; success: boolean } | Array<{ command: string; output: string; exitCode: number | null; duration: number; success: boolean }>;
}

function unwrapTerminalOps(operationResults: OperationResult[]): { toolKind: string; data: any }[] {
  return operationResults
    .filter(op => op.kind === 'terminal_command' && op.data)
    .flatMap(op => Array.isArray(op.data)
      ? op.data.map(d => ({ toolKind: 'terminal_command' as const, data: d }))
      : [{ toolKind: 'terminal_command' as const, data: op.data! }]);
}

function makeTerminalData(command: string, output: string = '') {
  return { command, output, exitCode: 0, duration: 100, success: true };
}

describe('SurgicalViewProvider - Terminal array unwrapping', () => {
  it('Test 1: Sequential commands produce multiple terminal sections', () => {
    const results: OperationResult[] = [
      {
        operationId: '1', operationIndex: 0, kind: 'terminal_command',
        status: 'success', message: '', path: '',
        data: [makeTerminalData('npm install'), makeTerminalData('npm run build'), makeTerminalData('npm test')],
      },
    ];

    const ops = unwrapTerminalOps(results);
    assert.strictEqual(ops.length, 3);
    assert.strictEqual(ops[0].data.command, 'npm install');
    assert.strictEqual(ops[1].data.command, 'npm run build');
    assert.strictEqual(ops[2].data.command, 'npm test');
  });

  it('Test 2: Single command produces one section', () => {
    const results: OperationResult[] = [
      {
        operationId: '2', operationIndex: 0, kind: 'terminal_command',
        status: 'success', message: '', path: '',
        data: makeTerminalData('echo hello'),
      },
    ];

    const ops = unwrapTerminalOps(results);
    assert.strictEqual(ops.length, 1);
    assert.strictEqual(ops[0].data.command, 'echo hello');
  });

  it('Test 3: Array data unwrapped correctly', () => {
    const cmd1 = makeTerminalData('git status');
    const cmd2 = makeTerminalData('git add .');
    const results: OperationResult[] = [
      {
        operationId: '3', operationIndex: 0, kind: 'terminal_command',
        status: 'success', message: '', path: '',
        data: [cmd1, cmd2],
      },
    ];

    const ops = unwrapTerminalOps(results);
    assert.strictEqual(ops.length, 2);
    assert.strictEqual(ops[0].data, cmd1);
    assert.strictEqual(ops[1].data, cmd2);
    assert.strictEqual(ops[0].toolKind, 'terminal_command');
    assert.strictEqual(ops[1].toolKind, 'terminal_command');
  });

  it('Test 4: Non-terminal results passed through unchanged', () => {
    const results: OperationResult[] = [
      {
        operationId: '4', operationIndex: 0, kind: 'read_file',
        status: 'success', message: '', path: '/a.ts',
      },
      {
        operationId: '5', operationIndex: 1, kind: 'terminal_command',
        status: 'success', message: '', path: '',
        data: makeTerminalData('ls'),
      },
    ];

    const ops = unwrapTerminalOps(results);
    assert.strictEqual(ops.length, 1);
    assert.strictEqual(ops[0].data.command, 'ls');
  });
});