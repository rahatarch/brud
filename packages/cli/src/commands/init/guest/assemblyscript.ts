import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEMPLATES_DIR } from '../../../core/paths.js';
import { commonFiles, packageJson, sourceJson } from './shared.js';

const TEMPLATES = join(TEMPLATES_DIR, 'guest', 'assembly');

const README = `# {{name}}\n\nA caged BrudOS participant (experimental). The guest is written in AssemblyScript and compiled ahead of time to WebAssembly for the Brud WASM cage: it runs at native speed.\n\n## Layout\n\n| Path | What it is |\n|---|---|\n| \`brud.participant.src.json\` | The participant's id, manifest, cage limits and guest entry |\n| \`assembly/index.ts\` | Your guest: exports \`brud_invoke\` |\n| \`assembly/brud.ts\` | The small guest interface (\`brud_alloc\`, \`readRequest\`, \`reply\`, \`callHost\`) |\n| \`dist/\` | Build output: \`participant.wasm\` and \`brud.participant.json\` (git-ignored) |\n\n## Build\n\n\`\`\`bash\nnpm install\nnpm run pack     # brud pack --verify\n\`\`\`\n\nThen list \`dist/brud.participant.json\` in a composition with \`"official": false\`. The CLI never changes who is official.\n\nNotes: the guest receives and returns raw JSON text; add a JSON library for AssemblyScript to parse requests. The kernel enforces fuel, memory and response-size limits. Prefer writing plain JavaScript or TypeScript? Scaffold with \`brud init <name> --guest --lang js\` (or \`ts\`); it runs slower, in an interpreter inside the cage.\n`;

/** Files of an AssemblyScript guest project. */
export function assemblyScriptFiles(name: string): Record<string, string> {
  return {
    'package.json': packageJson(name, { pack: 'brud pack --verify' }, { assemblyscript: '^0.28.0' }),
    'brud.participant.src.json': sourceJson(name, { source: 'assembly/index.ts' }, { fuel: 1_000_000, maxMemoryBytes: 16_777_216, deadlineMs: 5000 }),
    'assembly/brud.ts': readFileSync(join(TEMPLATES, 'brud.ts.template'), 'utf8'),
    'assembly/index.ts': readFileSync(join(TEMPLATES, 'index.ts.template'), 'utf8'),
    'assembly/tsconfig.json': readFileSync(join(TEMPLATES, 'tsconfig.json'), 'utf8'),
    ...commonFiles(name, README),
  };
}
