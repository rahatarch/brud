import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BrudParseError, scanBrudDocument } from '../parser/scanner.js';

const protectedText = (): readonly string[] => ['text'];

function document(...bodyLines: readonly string[]): string {
  return ['[BRUD]', '[CALL file write]', 'path: a.md', ...bodyLines, '[END]', '[/BRUD]'].join('\n');
}

/**
 * The protected-block closer is part of the grammar: a block ends at the first
 * own-line closer, so a body can never contain its own closer. These tests pin
 * what the Parser does when a writer breaks that rule, so a participant that
 * writes blocks knows it must refuse such content itself (defect item 7).
 */
describe('Protected block closer contract', () => {
  it('ends the block at the first own-line closer and keeps everything before it byte for byte', () => {
    const [call] = scanBrudDocument(document('{text}', 'one', '', '  two {braces}', '{/text}'), protectedText);

    assert.equal(call?.parameters.text, 'one\n\n  two {braces}');
  });

  it('treats an indented closer line as the closer', () => {
    const [call] = scanBrudDocument(document('{text}', 'one', '   {/text}'), protectedText);

    assert.equal(call?.parameters.text, 'one');
  });

  it('refuses loudly when the text after an early closer is not a key: value line', () => {
    assert.throws(
      () => scanBrudDocument(document('{text}', 'one', '{/text}', 'two', 'three'), protectedText),
      (error: unknown) => error instanceof BrudParseError && /key: value/u.test(error.message),
    );
  });

  it('cannot tell a key: value line after an early closer from a real parameter', () => {
    const [call] = scanBrudDocument(document('{text}', 'one', '{/text}', 'note: x'), protectedText);

    assert.deepEqual(call?.parameters, { path: 'a.md', text: 'one', note: 'x' });
  });
});
