import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bootKernel, type BrudKernel } from '../../index.js';
import type { ServiceContext } from '../contracts/lifecycle.js';
import {
  PARSER_DEFAULT_KIND,
  type IBrudParserService,
} from '../../services/Parser/contracts/index.js';
import { ParserToken } from '../../services/Parser/descriptor/tokens.js';
import { isValidRouterKind } from '../../services/Router/contracts/index.js';
import { workspaceContextOptions } from './support/workspaceContext.js';

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
  it('parses a bare header with the Parser\'s own default kind', async () => {
    const { kernel, parser } = await bootParserRouter();

    try {
      const parsed = parser.parse([
        '[BRUD]',
        '[CALL echo]',
        'text: hello',
        '[END]',
        '[/BRUD]',
      ].join('\n'));

      assert.equal(parsed.ok, true);

      if (!parsed.ok) {
        return;
      }

      assert.equal(parsed.operations[0]?.kind, PARSER_DEFAULT_KIND);
      assert.equal(parsed.operations[0]?.name, 'echo');
    } finally {
      await kernel.shutdown();
    }
  });

  it('validates kind tokens through its own contract validator', () => {
    assert.equal(isValidRouterKind(PARSER_DEFAULT_KIND), true);
    assert.equal(isValidRouterKind('action'), true);
    assert.equal(isValidRouterKind('widget-2'), true);
    assert.equal(isValidRouterKind('not a kind'), false);
    assert.equal(isValidRouterKind(''), false);
  });
});