import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bootKernel, type BrudKernel } from '../../../index.js';
import type { ServiceContext } from '../../../src/contracts/lifecycle.js';
import type { IBrudParserService } from '../contracts/index.js';
import { ParserToken } from '../descriptor/tokens.js';
import { isValidRouterKind } from '../../Router/contracts/index.js';
import { workspaceContextOptions } from '../../../src/__tests__/support/workspaceContext.js';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

/** Boots a real kernel that composes only the Parser and the Router. */
async function bootParserRouter(): Promise<{
  readonly kernel: BrudKernel;
  readonly parser: IBrudParserService;
}> {
  const root = await mkdtemp(join(tmpdir(), 'brud-parser-router-self-contained-'));
  roots.push(root);

  const configPath = join(root, 'brud.config.json');

  await writeFile(configPath, JSON.stringify({
    services: [
      { path: 'kernel:serviceModules/identityRegistry.js', official: true },
      { path: 'kernel:serviceModules/exposedApiRegistry.js', official: true },
      { path: 'kernel:serviceModules/parser.js', official: true },
      { path: 'kernel:serviceModules/router.js', official: true },
    ],
    plugins: [],
  }, null, 2), 'utf8');

  const options = workspaceContextOptions(root);
  const kernel = await bootKernel(configPath, { options });
  const caller: ServiceContext = { callerId: 'kernel', tier: 'core', options };

  return {
    kernel,
    parser: kernel.requestAccess<IBrudParserService>(caller, ParserToken),
  };
}

describe('Parser and Router kind declarations', () => {
  it('refuses a bare header because it names no operation kind', async () => {
    const { kernel, parser } = await bootParserRouter();

    try {
      const parsed = parser.parse([
        '[BRUD]',
        '[CALL echo]',
        'text: hello',
        '[END]',
        '[/BRUD]',
      ].join('\n'));

      assert.equal(parsed.ok, false);

      if (parsed.ok) {
        assert.fail('a bare [CALL] header must not parse');
      }

      assert.equal(parsed.error.code, 'PARSE_ERROR');
      assert.equal(
        parsed.error.friendly,
        'operation kind is required in [CALL] (line 2)',
      );
      assert.equal(parsed.error.details, parsed.error.friendly);
      assert.equal(parsed.error.line, 2);
    } finally {
      await kernel.shutdown();
    }
  });

  it('parses an explicit header with the kind written on it', async () => {
    const { kernel, parser } = await bootParserRouter();

    try {
      const parsed = parser.parse([
        '[BRUD]',
        '[CALL tool echo]',
        'text: hello',
        '[END]',
        '[/BRUD]',
      ].join('\n'));

      assert.equal(parsed.ok, true);

      if (!parsed.ok) {
        return;
      }

      assert.equal(parsed.operations.length, 1);
      assert.equal(parsed.operations[0]?.kind, 'tool');
      assert.equal(parsed.operations[0]?.name, 'echo');
    } finally {
      await kernel.shutdown();
    }
  });

  it('validates kind tokens through its own contract validator', () => {
    assert.equal(isValidRouterKind('tool'), true);
    assert.equal(isValidRouterKind('action'), true);
    assert.equal(isValidRouterKind('widget-2'), true);
    assert.equal(isValidRouterKind('not a kind'), false);
    assert.equal(isValidRouterKind(''), false);
  });
});