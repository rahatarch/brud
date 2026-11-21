import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEMPLATES_DIR } from '../../core/paths.js';
import { readOwnPackage } from '../../core/project.js';

const TEMPLATES = TEMPLATES_DIR;

/** Where the scaffold puts a participant, relative to the project root. */
export const participantPath = (name: string): string => `src/participants/${name}/index.mjs`;

function template(file: string): string {
  return readFileSync(join(TEMPLATES, file), 'utf8');
}

/** The example participant with its `acme.` ids renamed to this project's. */
function participantSource(name: string, kind: boolean): string {
  return template(kind ? 'kind.mjs' : 'participant.mjs').replace(/acme\./gu, `${name}.`);
}

/** The example test, pointed at the scaffold's layout (`test/participants/` -> `src/participants/<name>/`). */
function testSource(name: string, kind: boolean): string {
  return template(kind ? 'kind.test.mjs' : 'participant.test.mjs')
    .replace(/acme\./gu, `${name}.`)
    .replace(/'(?:vault|notes)\.mjs'/u, `'..', '..', 'src', 'participants', '${name}', 'index.mjs'`);
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

function readme(name: string, kind: boolean): string {
  const what = kind
    ? `\`${name}.notes\` owns the \`note\` kind: it accepts \`[CALL note add]\` and \`[CALL note list]\` documents.`
    : `\`${name}.vault\` gives one capability-gated API: a caller sees \`read\` with \`vault:read\` and \`write\` with \`vault:write\`.`;
  const trySection = kind
    ? '```bash\nnpm run call -- --file examples/notes.brud\nnpm run inspect\n```\n\n`call` boots the composition, sends the document in `examples/notes.brud`, and prints the route result.'
    : '```bash\nnpm run inspect -- --cap vault:read\n```\n\n`inspect` shows the participants in the composition and who can resolve each exposure; `--cap` probes a caller holding exactly those capabilities.';

  return `# ${name}

A [BrudOS](https://github.com/rahatarch/brud) project. ${what}

## Requirements

- Node.js 22 or newer

## Getting started

\`\`\`bash
npm install
npm test          # the participant's tests, on a real kernel
npm run doctor    # checks this machine and the composition
npm run check     # boots the composition in a scratch state and reports problems
npm start         # boots the kernel; routes Brud text read from stdin
\`\`\`

## Try it

${trySection}

## Project layout

| Path | What it is |
|---|---|
| \`brud.config.json\` | The composition: the kernel's hardcore services plus your participants, in order |
| \`src/participants/<name>/\` | One folder per participant; \`index.mjs\` exports \`createService\` |
| \`test/participants/\` | One test file per participant, booting a real kernel with \`@brud/sdk/testing\` |
| \`config/daemon.example.json\` | An operator config for running the composition through the Brud daemon |
${kind ? '| `examples/` | Sample Brud documents to send with `npm run call` |\n' : ''}| \`docs/\` | Notes on how this project is put together |
| \`.brud/\` | Local runtime state (git-ignored) |

## How the composition works

\`brud.config.json\` lists services in boot order. The kernel's hardcore entries (\`kernel:serviceModules/*.js\`) must all be present and \`"official": true\`; their trust is not yours to remove. Your own entries are yours to decide: a native module runs only when you declare it \`"official": true\`, and that line is the owner's decision, never the tool's. See [docs/architecture.md](docs/architecture.md).

## Adding a participant

1. Create \`src/participants/<new-name>/index.mjs\` exporting \`createService\` (see the existing one).
2. List it in \`brud.config.json\` after the hardcores: \`{ "path": "./src/participants/<new-name>/index.mjs", "official": true }\`.
3. Add \`test/participants/<new-name>.test.mjs\`.
4. Run \`npm test\` and \`npm run check\`.

## Scripts

| Script | Runs |
|---|---|
| \`npm test\` | \`node --test\` |
| \`npm run doctor\` | \`brud doctor\` |
| \`npm run check\` | \`brud check\` (exits 1 on any problem; used in CI) |
| \`npm run inspect\` | \`brud inspect\` |
| \`npm start\` | \`brud run\` |
| \`npm run call -- <text>\` | \`brud call\` |

## Running through the daemon

\`\`\`bash
mkdir -p .brud/daemon
cp config/daemon.example.json .brud/daemon/daemon.json
echo '<a Brud document>' | npx brud run --daemon --home .brud/daemon
\`\`\`

The example grants no capabilities to any client; edit \`principals\` to grant some.

## Learn more

[BrudOS documentation](https://github.com/rahatarch/brud/tree/main/docs-next)
`;
}

function architecture(name: string, kind: boolean): string {
  return `# Architecture notes

## What this project is

A BrudOS composition of one participant, \`${name}.${kind ? 'notes' : 'vault'}\`, on the kernel's hardcore services. The kernel gives every participant an identity and lets each giver decide who may use its APIs; it knows nothing about what this project does.

## Pieces

- **Composition** (\`brud.config.json\`): the ordered list of services the kernel boots.
- **Participant** (\`src/participants/${name}/index.mjs\`): ${kind ? 'owns the `note` kind and answers `add` and `list` operations.' : 'gives the `' + name + '.vault` API, shaped by the caller\'s capabilities.'}
- **Tests** (\`test/participants/${name}.test.mjs\`): boot a real kernel with the participant and exercise it as a caller would.
- **Daemon config** (\`config/daemon.example.json\`): how an operator would host this composition for other programs.

## Trust

- Hardcore services are the kernel's; they stay \`"official": true\`.
- A participant that runs as native code must be declared \`"official": true\` by the owner of this composition. Declare it only for code you trust.
- Untrusted code belongs in the WASM cage as a participant package (\`brud pack\`); it is declared \`"official": false\`.
- Capabilities are granted by the giver's exposure policy, not by the caller asking.

## Checks

\`npm test\`, \`npm run check\` and \`npm run doctor\` should all pass before a change is merged; CI runs the first two.
`;
}

const CI = `name: CI

on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install --no-audit --no-fund
      - run: npm test
      - run: npx brud check
`;

const EDITORCONFIG = `root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true
`;

const SAMPLE_DOCUMENT = `[BRUD]
[CALL note add]
text: buy milk
[END]
[CALL note add]
text: call Sam
[END]
[CALL note list]
[END]
[/BRUD]
`;

/**
 * Every file of the scaffolded project except \`brud.config.json\`, which needs
 * the installed kernel's hardcore list and is written after install.
 */
export function projectFiles(name: string, kind: boolean): Readonly<Record<string, string>> {
  const own = readOwnPackage();

  return {
    'package.json': json({
      name,
      version: '0.1.0',
      description: `A BrudOS project: ${kind ? 'a participant that owns a kind' : 'a capability-gated participant'}`,
      private: true,
      type: 'module',
      engines: { node: own.engines.node },
      scripts: {
        start: 'brud run',
        test: 'node --test',
        doctor: 'brud doctor',
        check: 'brud check',
        inspect: 'brud inspect',
        call: 'brud call',
      },
      dependencies: { '@brud/kernel': own.peerDependencies['@brud/kernel'], '@brud/sdk': own.peerDependencies['@brud/sdk'] },
      devDependencies: { '@brud/cli': `^${own.version}` },
    }),
    'README.md': readme(name, kind),
    'docs/architecture.md': architecture(name, kind),
    [participantPath(name)]: participantSource(name, kind),
    [`test/participants/${name}.test.mjs`]: testSource(name, kind),
    'config/daemon.example.json': json({ composition: '../../brud.config.json', fixedOptions: {}, clientOptions: [], principals: { ui: [], ai: [] }, reuseIdenticalBoots: false }),
    '.github/workflows/ci.yml': CI,
    '.editorconfig': EDITORCONFIG,
    '.nvmrc': '22\n',
    '.gitignore': 'node_modules\n.brud\n*.log\n.DS_Store\n',
    ...(kind ? { 'examples/notes.brud': SAMPLE_DOCUMENT } : {}),
  };
}
