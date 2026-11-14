import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ParserService } from '../orchestrator/ParserService.js';
import { BrudParseError, scanBrudDocument } from '../parser/scanner.js';

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const TEST_DIRECTORY = '__tests__/';

/**
 * A default-kind declaration, whatever its spelling.
 *
 * Matches `PARSER_DEFAULT_KIND`, `DEFAULT_KIND`, `DEFAULT_OPERATION_KIND`,
 * and a lower-case `defaultKind`.
 */
const DEFAULT_KIND_DECLARATION = /(?:DEFAULT[A-Z0-9_]*KIND|defaultKind)/u;

/** Reads every production TypeScript file in the Parser package. */
async function productionSources(): Promise<readonly {
  readonly path: string;
  readonly source: string;
}[]> {
  const entries = await readdir(PACKAGE_ROOT, { recursive: true });

  const sources: { readonly path: string; readonly source: string }[] = [];

  for (const entry of entries) {
    const relativePath = relative(PACKAGE_ROOT, join(PACKAGE_ROOT, entry));

    if (!relativePath.endsWith('.ts') || relativePath.startsWith(TEST_DIRECTORY)) {
      continue;
    }

    sources.push({
      path: relativePath,
      source: await readFile(join(PACKAGE_ROOT, relativePath), 'utf8'),
    });
  }

  return sources;
}

/** Returns the production files that declare a default kind. */
function defaultKindDeclarations(
  sources: readonly { readonly path: string; readonly source: string }[],
): readonly string[] {
  return sources
    .filter((file) => DEFAULT_KIND_DECLARATION.test(file.source))
    .map((file) => file.path);
}

describe('Parser default-kind boundary (BC-PARSER-DEFAULT-KIND)', () => {
  it('declares no default kind anywhere in the package', async () => {
    assert.deepEqual(defaultKindDeclarations(await productionSources()), []);
  });

  it('detects a reintroduced default-kind declaration (guard canary)', () => {
    assert.deepEqual(
      defaultKindDeclarations([
        { path: 'contracts/kind.ts', source: "export const PARSER_DEFAULT_KIND = 'tool' as const;\n" },
      ]),
      ['contracts/kind.ts'],
    );

    assert.deepEqual(
      defaultKindDeclarations([
        { path: 'parser/scanner.ts', source: 'const defaultKind = "tool";\n' },
      ]),
      ['parser/scanner.ts'],
    );

    assert.deepEqual(
      defaultKindDeclarations([
        { path: 'parser/scanner.ts', source: 'const kind = header.kind;\n' },
      ]),
      [],
    );
  });

  it('refuses a bare header instead of supplying a kind', () => {
    assert.throws(
      () => scanBrudDocument('[BRUD]\n[CALL echo]\n[END]\n[/BRUD]', () => undefined),
      (error: unknown) => {
        assert.ok(error instanceof BrudParseError);
        assert.equal(error.code, 'PARSE_ERROR');
        assert.equal(error.line, 2);
        assert.equal(error.message, 'operation kind is required in [CALL] (line 2)');
        return true;
      },
    );

    const result = new ParserService().parse('[BRUD]\n[CALL echo]\n[END]\n[/BRUD]');

    assert.equal(result.ok, false);

    if (result.ok) {
      return;
    }

    assert.equal(result.error.code, 'PARSE_ERROR');
    assert.equal(result.error.line, 2);
    assert.equal(result.error.friendly, 'operation kind is required in [CALL] (line 2)');
  });

  it('still parses an explicit header with the declared kind', () => {
    const result = new ParserService().parse('[BRUD]\n[CALL tool echo]\n[END]\n[/BRUD]');

    assert.equal(result.ok, true);

    if (!result.ok) {
      return;
    }

    assert.equal(result.operations[0]?.kind, 'tool');
    assert.equal(result.operations[0]?.name, 'echo');
  });
});