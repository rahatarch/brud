import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseArgs, UsageError } from './args.js';

test('parseArgs reads positionals, booleans, values, =values and repeats', () => {
  const args = parseArgs(['one', '--json', '--home', '/h', '--tier=ai', '--cap', 'a', '--cap=b'], { value: ['tier'], repeat: ['cap'] });

  assert.deepEqual(args.positionals, ['one']);
  assert.equal(args.flags.get('json'), true);
  assert.equal(args.flags.get('home'), '/h');
  assert.equal(args.flags.get('tier'), 'ai');
  assert.deepEqual(args.lists.get('cap'), ['a', 'b']);
});

test('parseArgs rejects unknown flags, missing values and values on booleans', () => {
  assert.throws(() => parseArgs(['--nope']), UsageError);
  assert.throws(() => parseArgs(['--home']), UsageError);
  assert.throws(() => parseArgs(['--home', '--json']), UsageError);
  assert.throws(() => parseArgs(['--json=1']), UsageError);
});
