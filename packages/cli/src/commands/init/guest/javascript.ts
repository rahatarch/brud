import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEMPLATES_DIR } from '../../../core/paths.js';
import { commonFiles, packageJson, sourceJson } from './shared.js';

const TEMPLATES = join(TEMPLATES_DIR, 'guest', 'javascript');

/** A JavaScript handler needs a large fuel budget: the interpreter spends about 2,000 fuel per simple loop step. */
const LIMITS = { fuel: 3_000_000_000, maxMemoryBytes: 33_554_432, deadlineMs: 10_000 };

function readme(typescript: boolean): string {
  const entry = typescript ? 'src/index.ts' : 'src/index.js';

  return `# {{name}}\n\nA caged BrudOS participant (experimental). The guest is written in ${typescript ? 'TypeScript' : 'JavaScript'} and runs in the Brud WASM cage inside a JavaScript engine (QuickJS) that \`brud pack\` bundles your code into.\n\n## Layout\n\n| Path | What it is |\n|---|---|\n| \`brud.participant.src.json\` | The participant's id, manifest, cage limits and guest entry |\n| \`${entry}\` | Your guest: \`export default function handler(request)\` |\n${typescript ? '| `src/brud.ts` | Types for the request and the global `brud.call` |\n' : ''}| \`dist/\` | Build output: \`participant.wasm\` and \`brud.participant.json\` (git-ignored) |\n\n## Build\n\n\`\`\`bash\nnpm install\nnpm run pack     # brud pack --verify\n\`\`\`\n\nThen list \`dist/brud.participant.json\` in a composition with \`"official": false\`. The CLI never changes who is official.\n\n## What to know\n\n- There is no Node in the cage: no \`process\`, files, network, \`console\` or clock. \`brud.call(name, method, args)\` is the one way out.\n- It is an interpreter, so it is much slower than AssemblyScript on heavy work, and the participant takes about 650 ms to start. The cage's \`fuel\` is spent about 2,000 per simple loop step; \`limits\` in \`brud.participant.src.json\` start generous for that reason.\n- Handlers are synchronous.\n${typescript ? '- Types are removed when you build, not checked. Run `npm run typecheck`.\n' : ''}`;
}

/** Files of a JavaScript (`ts` false) or TypeScript (`ts` true) guest project. */
export function javaScriptFiles(name: string, typescript: boolean): Record<string, string> {
  const entry = typescript ? 'src/index.ts' : 'src/index.js';
  const scripts = { pack: 'brud pack --verify', ...(typescript ? { typecheck: 'tsc --noEmit' } : {}) };
  const devDependencies = { esbuild: '^0.25.0', ...(typescript ? { typescript: '^5.6.0' } : {}) };

  return {
    'package.json': packageJson(name, scripts, devDependencies),
    'brud.participant.src.json': sourceJson(name, { source: entry, language: 'javascript' }, LIMITS),
    [entry]: readFileSync(join(TEMPLATES, typescript ? 'index.ts.template' : 'index.js.template'), 'utf8'),
    ...(typescript ? { 'src/brud.ts': readFileSync(join(TEMPLATES, 'brud.ts.template'), 'utf8'), 'tsconfig.json': readFileSync(join(TEMPLATES, 'tsconfig.json'), 'utf8') } : {}),
    ...commonFiles(name, readme(typescript)),
  };
}
