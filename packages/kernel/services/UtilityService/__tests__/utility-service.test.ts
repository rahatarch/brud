import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStandardKernel } from '../../../src/bootstrap/index.js';
import type { ServiceContext } from '../../../src/contracts/lifecycle.js';
import type { IBrudPlugin } from '../../PluginManager/contracts/IBrudPlugin.js';
import { DurableNodeStorageDriver } from '../../BrudFileSystem/drivers/DurableNodeStorageDriver.js';
import { safeRm } from '../../../src/__tests__/support/cleanup.js';
import type { IUtilityService } from '../contracts/IUtilityService.js';
import { UtilityToken } from '../descriptor/tokens.js';
import { UtilityService } from '../orchestrator/UtilityService.js';

const TS_CONTENT = [
  "import { helper } from './b';",
  "import type { Shape } from './types';",
  "import * as c from './c';",
  "const lazy = await import('./d');",
  "const req = require('./e');",
  "import React from 'react';",
].join('\n');

const JS_CONTENT = TS_CONTENT;
const PY_CONTENT = [
  'import os',
  'from .helper import value',
  'from sys import argv',
].join('\n');

function virtualProbe(root: string, existing: readonly string[]): {
  readonly filePath: string;
  readonly fileExists: (path: string) => boolean;
  readonly expected: string[];
} {
  const files = new Set(existing.map((file) => join(root, file)));

  return {
    filePath: join(root, 'main.ts'),
    fileExists: (candidate: string): boolean => files.has(candidate),
    expected: [...files],
  };
}

describe('brud.core.utils service', () => {
  let root: string;
  let kernel: ReturnType<typeof createStandardKernel>;
  let observed: string[] | undefined;

  before(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'brud-utility-service-')));

    const tsRoot = join(root, 'ts');
    const jsRoot = join(root, 'js');
    const pyRoot = join(root, 'py');

    const tsProbe = virtualProbe(tsRoot, ['types.ts', 'b.ts', 'c/index.ts', 'e.ts', 'd.ts']);
    const jsProbe = virtualProbe(jsRoot, ['types.js', 'b.js', 'c/index.js', 'e.js', 'd.js']);
    const pyFiles = new Set([join(pyRoot, '.helper.ts')]);

    const plugin: IBrudPlugin = {
      manifest: {
        id: 'acme.utility.consumer',
        name: 'Utility consumer',
        version: '1.0.0',
        permissions: [],
      },
      activate: async (context): Promise<void> => {
        const utilities = context.getUtilities();

        assert.equal(utilities, context.getUtilities(), 'getUtilities must be memoized');

        const ts = await utilities.resolveImports(TS_CONTENT, {
          filePath: tsProbe.filePath,
          fileExists: tsProbe.fileExists,
        });
        const js = await utilities.resolveImports(
          JS_CONTENT,
          jsProbe.filePath,
          jsProbe.fileExists,
        );
        const py = await utilities.resolveImports(PY_CONTENT, {
          filePath: join(pyRoot, 'main.py'),
          fileExists: (candidate: string): boolean => pyFiles.has(candidate),
          language: 'python',
        });

        observed = [...ts, ...js, ...py];
      },
    };

    kernel = createStandardKernel({
      storageDriver: new DurableNodeStorageDriver(),
      history: { dbPath: join(root, '.brud', 'history', 'universal.db') },
      initialPlugins: [plugin],
    });

    await kernel.boot({ workspaceRoot: root });
  });

  after(async () => {
    try {
      await kernel.shutdown();
    } finally {
      await safeRm(root);
    }
  });

  it('boots and exposes resolveImports on the registered service', () => {
    const caller: ServiceContext = {
      callerId: 'test.utility-service',
      tier: 'core',
      workspaceRoot: root,
    };
    const utilities = kernel.requestAccess(caller, UtilityToken);

    assert.equal(typeof utilities.resolveImports, 'function');
  });

  it('makes getUtilities() available on a plugin context and resolves every language', () => {
    assert.ok(observed !== undefined, 'the plugin must activate and call getUtilities()');

    assert.deepEqual(observed, [
      join(root, 'ts', 'types.ts'),
      join(root, 'ts', 'b.ts'),
      join(root, 'ts', 'c', 'index.ts'),
      join(root, 'ts', 'e.ts'),
      join(root, 'ts', 'd.ts'),
      join(root, 'js', 'types.js'),
      join(root, 'js', 'b.js'),
      join(root, 'js', 'c', 'index.js'),
      join(root, 'js', 'e.js'),
      join(root, 'js', 'd.js'),
      join(root, 'py', '.helper.ts'),
    ]);
  });

  it('returns the same array from a standalone service instance', async () => {
    const service: IUtilityService = new UtilityService();
    const files = new Set([join(root, 'standalone', 'b.ts')]);

    const result = await service.resolveImports("import { b } from './b';", {
      filePath: join(root, 'standalone', 'main.ts'),
      fileExists: (candidate: string): boolean => files.has(candidate),
    });

    assert.deepEqual(result, [join(root, 'standalone', 'b.ts')]);
  });
});