import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ParserService } from '../orchestrator/ParserService.js';
import { BrudParseError, scanBrudDocument } from '../parser/scanner.js';
import { BRUD_PARSE_ERROR } from '../parser/syntax.js';

const resolveNothing = (): undefined => undefined;

function documentOf(...lines: readonly string[]): string {
  return lines.join('\n');
}

describe('Brud parser scanner headers', () => {
  it('parses an explicit kind and name', () => {
    const calls = scanBrudDocument(documentOf(
      '[BRUD]',
      '[CALL action list_sessions]',
      'scope: all',
      '[END]',
      '[/BRUD]',
    ), resolveNothing);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.kind, 'action');
    assert.equal(calls[0]?.name, 'list_sessions');
    assert.equal(calls[0]?.line, 2);
    assert.deepEqual(calls[0]?.parameters, { scope: 'all' });
  });

  it('accepts any shape-valid explicit kind', () => {
    const calls = scanBrudDocument(documentOf(
      '[BRUD]',
      '[CALL widget-2 echo]',
      '[END]',
      '[/BRUD]',
    ), resolveNothing);

    assert.equal(calls[0]?.kind, 'widget-2');
    assert.equal(calls[0]?.name, 'echo');
  });

  it('refuses a bare header because it names no kind', () => {
    assert.throws(
      () => scanBrudDocument(documentOf(
        '[BRUD]',
        '[CALL echo]',
        '[END]',
        '[/BRUD]',
      ), resolveNothing),
      (error: unknown) => {
        assert.ok(error instanceof BrudParseError);
        assert.equal(error.code, BRUD_PARSE_ERROR);
        assert.equal(error.line, 2);
        assert.equal(error.message, 'operation kind is required in [CALL] (line 2)');
        return true;
      },
    );
  });

  it('refuses an invalid explicit kind', () => {
    assert.throws(
      () => scanBrudDocument(documentOf(
        '[BRUD]',
        '[CALL bad-kind! echo]',
        '[END]',
        '[/BRUD]',
      ), resolveNothing),
      (error: unknown) => {
        assert.ok(error instanceof BrudParseError);
        assert.equal(error.code, BRUD_PARSE_ERROR);
        assert.equal(error.line, 2);
        assert.equal(error.message, 'invalid operation kind "bad-kind!" (line 2)');
        return true;
      },
    );
  });

  it('refuses a call that never closes', () => {
    assert.throws(
      () => scanBrudDocument(documentOf(
        '[BRUD]',
        '[CALL tool echo]',
        'text: hello',
        '[/BRUD]',
      ), resolveNothing),
      (error: unknown) => {
        assert.ok(error instanceof BrudParseError);
        assert.equal(error.message, 'missing [END] for [CALL] (line 2)');
        return true;
      },
    );
  });

  it('surfaces a bare header as a typed parse failure through the service', () => {
    const service = new ParserService();
    const result = service.parse(documentOf(
      '[BRUD]',
      '[CALL echo]',
      '[END]',
      '[/BRUD]',
    ));

    assert.equal(result.ok, false);

    if (result.ok) {
      return;
    }

    assert.equal(result.error.code, BRUD_PARSE_ERROR);
    assert.equal(result.error.line, 2);
    assert.equal(result.error.friendly, 'operation kind is required in [CALL] (line 2)');
    assert.equal(result.error.details, result.error.friendly);
  });
});