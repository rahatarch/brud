import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { compare, distTag, isPrerelease, isValid, majorMinor } from '../lib/semver.mjs';

test('accepts release and prerelease versions, rejects the rest', () => {
  for (const v of ['0.0.1', '1.2.3', '1.0.0-beta.1', '2.0.0-rc.10']) assert.ok(isValid(v), v);
  for (const v of ['1', '1.2', 'v1.2.3', '01.2.3', '1.2.3+build', '1.2.3-', '']) assert.ok(!isValid(v), v);
});

test('orders versions by SemVer precedence', () => {
  assert.equal(compare('0.0.2', '0.0.1'), 1);
  assert.equal(compare('0.0.1', '0.0.1'), 0);
  assert.equal(compare('1.0.0-beta.2', '1.0.0-beta.10'), -1);
  assert.equal(compare('1.0.0-beta.1', '1.0.0'), -1);
  assert.equal(compare('1.0.0-alpha', '1.0.0-alpha.1'), -1);
  assert.equal(compare('1.0.0-1', '1.0.0-alpha'), -1);
  assert.throws(() => compare('x', '1.0.0'));
});

test('a prerelease never takes the latest dist-tag', () => {
  assert.equal(distTag('1.0.0'), 'latest');
  assert.equal(distTag('0.0.1'), 'latest');
  assert.equal(distTag('1.0.0-beta.1'), 'next');
  assert.ok(isPrerelease('1.0.0-rc.1'));
});

test('majorMinor gives the kernel line', () => {
  assert.equal(majorMinor('0.0.7'), '0.0');
  assert.equal(majorMinor('1.4.2-beta.1'), '1.4');
});
