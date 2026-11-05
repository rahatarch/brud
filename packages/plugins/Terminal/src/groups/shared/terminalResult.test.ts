import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  failureCodeFor,
  failureDetailsFor,
  terminalFailureResult,
  toCommandGroup,
  toMilliseconds,
} from './terminalResult.js';

describe('terminal result helpers', () => {
  it('converts seconds to milliseconds and applies the 120s default', () => {
    assert.equal(toMilliseconds(2), 2000);
    assert.equal(toMilliseconds(0.5), 500);
    assert.equal(toMilliseconds(undefined), 120000);
    assert.equal(toMilliseconds(0), 120000);
    assert.equal(toMilliseconds(Number.NaN), 120000);
  });

  it('wraps a conditional branch string in a sequential group', () => {
    assert.deepEqual(toCommandGroup('echo ok'), {
      type: 'sequential',
      commands: ['echo ok'],
      stopOnFailure: true,
    });
  });

  it('maps interrupted, timeout, and output-limit outcomes to stable codes', () => {
    assert.equal(
      failureCodeFor({ success: false, output: '', exitCode: null, duration: 1, status: 'interrupted' }),
      'TERMINAL_INTERRUPTED',
    );
    assert.equal(
      failureCodeFor({
        success: false,
        output: '',
        exitCode: null,
        duration: 1,
        status: 'failed',
        failure: 'TERMINAL_TIMEOUT',
      }),
      'TERMINAL_TIMEOUT',
    );
    assert.equal(
      failureCodeFor({
        success: false,
        output: '',
        exitCode: null,
        duration: 1,
        status: 'failed',
        failure: 'TERMINAL_OUTPUT_LIMIT',
      }),
      'TERMINAL_OUTPUT_LIMIT',
    );
  });

  it('builds a structured failure envelope with an error object', () => {
    const result = terminalFailureResult({
      code: 'TERMINAL_TIMEOUT',
      message: 'Terminal command failed.',
      details: 'The command "sleep 5" did not finish within 1 seconds and was terminated.',
      command: 'sleep 5',
      exitCode: null,
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.code, 'TERMINAL_TIMEOUT');
    assert.ok(result.error instanceof Error);
    assert.match((result.error as Error).message, /TERMINAL_TIMEOUT/);
    assert.deepEqual(result.data, {
      code: 'TERMINAL_TIMEOUT',
      details: 'The command "sleep 5" did not finish within 1 seconds and was terminated.',
      command: 'sleep 5',
      exitCode: null,
    });
  });

  it('formats timeout, interruption, and output-limit details', () => {
    const outcome = { success: false, output: 'x', exitCode: 1, duration: 2, status: 'failed' as const, failure: 'TERMINAL_TIMEOUT' as const };

    assert.match(failureDetailsFor('TERMINAL_TIMEOUT', 'cmd', outcome, 1000), /within 1 seconds/);
    assert.match(failureDetailsFor('TERMINAL_INTERRUPTED', 'cmd', outcome, 1000), /cancelled/);
    assert.match(failureDetailsFor('TERMINAL_OUTPUT_LIMIT', 'cmd', outcome, 1000), /truncated/);
    assert.match(failureDetailsFor('EXECUTION_FAILED', 'cmd', outcome, 1000), /exited with code 1/);
  });
});