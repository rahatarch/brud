import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Builds a throwaway repo layout with the four core packages, one service and a lockfile. */
export function makeRepo(version = '0.0.1', overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'brud-release-test-'));
  const write = (rel, content) => {
    const file = join(root, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  };
  const base = (name, extra = {}) => ({
    name: `@brud/${name}`,
    version,
    license: 'Apache-2.0',
    repository: { type: 'git', url: 'git+https://github.com/o/r.git' },
    engines: { node: '>=22' },
    publishConfig: { access: 'public' },
    ...extra,
  });
  const caret = `^${version}`;
  const manifests = {
    'packages/protocol': base('protocol'),
    'packages/kernel': base('kernel'),
    'packages/sdk': base('sdk', { peerDependencies: { '@brud/kernel': caret } }),
    'packages/daemon': base('daemon', { dependencies: { '@brud/kernel': caret, '@brud/protocol': caret } }),
    'packages/services/settings': base('service-settings', { dependencies: { '@brud/kernel': '*' } }),
  };
  for (const [dir, json] of Object.entries(manifests)) {
    write(`${dir}/package.json`, overrides[dir] ?? json);
  }
  for (const dir of ['protocol', 'kernel', 'sdk', 'daemon']) {
    write(`packages/${dir}/README.md`, '# readme\n');
    write(`packages/${dir}/LICENSE`, 'license\n');
  }
  write('packages/sdk/src/core/contract.ts',
    `export const SDK_VERSION = '${version}';\nexport const SDK_TARGET_KERNEL = '${version.split('.').slice(0, 2).join('.')}';\n`);
  const lockPackages = { '': { name: 'root' } };
  for (const [dir, json] of Object.entries(manifests)) {
    lockPackages[dir] = { name: json.name, version, dependencies: json.dependencies, peerDependencies: json.peerDependencies };
  }
  write('package.json', { name: 'root', private: true, workspaces: ['packages/*', 'packages/services/*'] });
  write('package-lock.json', { lockfileVersion: 3, packages: lockPackages });
  return { root, write };
}
