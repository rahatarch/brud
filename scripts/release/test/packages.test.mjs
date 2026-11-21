import { strict as assert } from 'node:assert';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { bumpManifest, checkVersions, loadCore, publishOrder, updateContract } from '../lib/packages.mjs';
import { makeRepo } from './helpers.mjs';

test('publish order puts dependencies first', () => {
  const { root } = makeRepo();
  const order = publishOrder(loadCore(root)).map((p) => p.json.name);
  assert.ok(order.indexOf('@brud/kernel') < order.indexOf('@brud/sdk'));
  assert.ok(order.indexOf('@brud/kernel') < order.indexOf('@brud/daemon'));
  assert.ok(order.indexOf('@brud/protocol') < order.indexOf('@brud/daemon'));
  assert.equal(order.length, 4);
});

test('a dependency cycle is rejected', () => {
  const { root, write } = makeRepo();
  write('packages/kernel/package.json', {
    name: '@brud/kernel', version: '0.0.1', dependencies: { '@brud/daemon': '^0.0.1' },
  });
  assert.throws(() => publishOrder(loadCore(root)), /cycle/);
});

test('a consistent tree has no problems', () => {
  const { root } = makeRepo();
  assert.deepEqual(checkVersions(root, { version: '0.0.1', tag: 'v0.0.1' }), []);
});

test('a version mismatch is reported', () => {
  const { root, write } = makeRepo();
  const j = JSON.parse(readFileSync(join(root, 'packages/sdk/package.json'), 'utf8'));
  j.version = '0.0.2';
  write('packages/sdk/package.json', j);
  const problems = checkVersions(root, { version: '0.0.1' });
  assert.ok(problems.some((p) => /@brud\/sdk: version is 0\.0\.2/.test(p)));
});

test('a wrong tag, a stale range, and a stale contract are reported', () => {
  const { root, write } = makeRepo();
  assert.ok(checkVersions(root, { version: '0.0.1', tag: 'v0.0.2' }).some((p) => /does not match version/.test(p)));
  assert.deepEqual(checkVersions(root, { version: '0.0.1' }), []); // a service may use "*"
  write('packages/services/settings/package.json', {
    name: '@brud/service-settings', version: '0.0.1', peerDependencies: { '@brud/kernel': '^0.0.0' },
  });
  assert.ok(checkVersions(root, { version: '0.0.1' }).some((p) => /service-settings.*\^0\.0\.0/.test(p)));
  write('packages/sdk/src/core/contract.ts', "export const SDK_VERSION = '0.0.9';\nexport const SDK_TARGET_KERNEL = '0.1';\n");
  const problems = checkVersions(root, { version: '0.0.1' });
  assert.ok(problems.some((p) => /SDK_VERSION is 0\.0\.9/.test(p)));
  assert.ok(problems.some((p) => /SDK_TARGET_KERNEL is 0\.1/.test(p)));
});

test('missing README, private flag, install script and stale lockfile are reported', () => {
  const { root, write } = makeRepo();
  rmSync(join(root, 'packages/kernel/README.md'));
  write('packages/protocol/package.json', {
    name: '@brud/protocol', version: '0.0.1', private: true, license: 'x', repository: 'r',
    engines: { node: '>=22' }, publishConfig: { access: 'public' }, scripts: { postinstall: 'node x.js' },
  });
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  lock.packages['packages/daemon'].version = '0.0.0';
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock));
  const text = checkVersions(root, { version: '0.0.1' }).join('\n');
  assert.match(text, /@brud\/kernel: README\.md is missing/);
  assert.match(text, /@brud\/protocol: is marked private/);
  assert.match(text, /@brud\/protocol: has an install-time script \(postinstall\)/);
  assert.match(text, /package-lock\.json packages\/daemon is 0\.0\.0/);
});

test('an invalid version is refused outright', () => {
  const { root } = makeRepo();
  assert.match(checkVersions(root, { version: 'v1' })[0], /not a valid version/);
});

test('bumpManifest moves the version and caret ranges, and nothing else', () => {
  const core = new Set(['@brud/kernel', '@brud/sdk']);
  const j = bumpManifest({
    name: '@brud/sdk', version: '0.0.1',
    peerDependencies: { '@brud/kernel': '^0.0.1' },
    dependencies: { '@brud/protocol': '^0.0.1', left: '^1.0.0', local: 'file:../x' },
  }, '0.0.2', core);
  assert.equal(j.version, '0.0.2');
  assert.equal(j.peerDependencies['@brud/kernel'], '^0.0.2');
  assert.equal(j.dependencies['@brud/protocol'], '^0.0.1'); // not in the core set passed here
  assert.equal(j.dependencies.left, '^1.0.0');
  const svc = bumpManifest({ name: '@brud/service-x', version: '0.0.1', peerDependencies: { '@brud/kernel': '^0.0.1' } }, '0.0.2', core);
  assert.equal(svc.version, '0.0.1'); // a non-core package keeps its own version
  assert.equal(svc.peerDependencies['@brud/kernel'], '^0.0.2');
});

test('updateContract rewrites both constants and refuses a file without them', () => {
  const out = updateContract("export const SDK_VERSION = '0.0.1';\nexport const SDK_TARGET_KERNEL = '0.0';\n", '0.3.4');
  assert.match(out, /SDK_VERSION = '0\.3\.4'/);
  assert.match(out, /SDK_TARGET_KERNEL = '0\.3'/);
  assert.throws(() => updateContract('nothing here', '1.0.0'));
});
