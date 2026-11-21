import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The scaffold templates are the tested examples in docs-next/examples. This
 * copies them into the package so the published CLI carries them, and the
 * templates test fails when a committed copy differs from its example.
 */
const examples = fileURLToPath(new URL('../../../docs-next/examples/', import.meta.url));
const templates = fileURLToPath(new URL('../templates/', import.meta.url));
const COPIES = { 'vault.mjs': 'participant.mjs', 'vault.test.mjs': 'participant.test.mjs', 'notes.mjs': 'kind.mjs' };

if (!existsSync(examples)) {
  process.stdout.write('docs-next/examples not found; keeping the committed templates\n');
  process.exit(0);
}

mkdirSync(templates, { recursive: true });

for (const [from, to] of Object.entries(COPIES)) {
  copyFileSync(`${examples}${from}`, `${templates}${to}`);
}

process.stdout.write(`templates synced from docs-next/examples (${String(Object.keys(COPIES).length)} files)\n`);
