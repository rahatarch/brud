import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseArgs, UsageError } from '../src/args.js';
import { satisfies } from '../src/project.js';

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

test('satisfies handles the caret and >= ranges Brud packages publish', () => {
  assert.equal(satisfies('0.1.4', '^0.1.4'), true);
  assert.equal(satisfies('0.1.9', '^0.1.4'), true);
  assert.equal(satisfies('0.2.0', '^0.1.4'), false);
  assert.equal(satisfies('0.1.3', '^0.1.4'), false);
  assert.equal(satisfies('1.4.0', '^1.2.0'), true);
  assert.equal(satisfies('2.0.0', '^1.2.0'), false);
  assert.equal(satisfies('22.23.4', '>=22'), true);
  assert.equal(satisfies('20.1.0', '>=22'), false);
});
