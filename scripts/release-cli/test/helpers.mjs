import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Builds a throwaway repo layout with the CLI package and a lockfile. */
export function makeRepo(version = '0.0.1', manifestOverride = {}) {
  const root = mkdtempSync(join(tmpdir(), 'brud-cli-release-test-'));
  const write = (rel, content) => {
    const file = join(root, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  };
  const manifest = {
    name: '@brud/cli',
    version,
    license: 'Apache-2.0',
    repository: { type: 'git', url: 'git+https://github.com/o/r.git' },
    engines: { node: '>=22' },
    publishConfig: { access: 'public' },
    bin: { brud: 'dist/cli.js' },
    peerDependencies: { '@brud/kernel': '^0.0.1', '@brud/sdk': '^0.0.1', '@brud/daemon': '^0.0.1' },
    ...manifestOverride,
  };
  write('packages/cli/package.json', manifest);
  write('packages/cli/README.md', '# readme\n');
  write('packages/cli/LICENSE', 'license\n');
  write('package.json', { name: 'root', private: true, workspaces: ['packages/*'] });
  write('package-lock.json', { lockfileVersion: 3, packages: { '': { name: 'root' }, 'packages/cli': { name: '@brud/cli', version, peerDependencies: manifest.peerDependencies } } });
  return { root, write };
}
