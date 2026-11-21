import { readOwnPackage } from '../../../core/project.js';

/** The language a guest project is scaffolded in. */
export type GuestLang = 'as' | 'js' | 'ts';

export const GUEST_LANGS: readonly GuestLang[] = ['as', 'js', 'ts'];

/** Files every guest project has, whatever its language. */
export function commonFiles(name: string, readme: string): Record<string, string> {
  return {
    '.gitignore': 'node_modules\ndist\n*.log\n.DS_Store\n',
    '.editorconfig': 'root = true\n\n[*]\ncharset = utf-8\nend_of_line = lf\nindent_style = space\nindent_size = 2\ninsert_final_newline = true\ntrim_trailing_whitespace = true\n',
    'README.md': readme.replace('{{name}}', name),
  };
}

/** The `package.json` of a guest project: the Brud peers, the CLI, and the language's toolchain. */
export function packageJson(name: string, scripts: Record<string, string>, devDependencies: Record<string, string>): string {
  const own = readOwnPackage();

  return `${JSON.stringify({
    name,
    version: '0.0.0',
    private: true,
    type: 'module',
    scripts,
    dependencies: { '@brud/kernel': own.peerDependencies['@brud/kernel'], '@brud/sdk': own.peerDependencies['@brud/sdk'] },
    devDependencies: { '@brud/cli': `^${own.version}`, ...devDependencies },
  }, null, 2)}\n`;
}

/** The `brud.participant.src.json` of a guest project. */
export function sourceJson(name: string, guest: Record<string, string>, limits: Record<string, number>): string {
  const id = `${name}.guest`;

  return `${JSON.stringify({
    id,
    manifest: {
      requests: { capabilities: [] },
      exposures: [{ name: `${id}.hello`, version: 1, scope: 'any', policy: { policyVersion: 2, capabilities: [`${name}:read`] } }],
    },
    limits,
    guest,
  }, null, 2)}\n`;
}
