import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import type { IUtilityService } from '../contracts/IUtilityService.js';
import { UtilityToken } from '../descriptor/tokens.js';
import { UTILITY_SERVICE_TIER, createUtilityDescriptor } from '../descriptor/UtilityServiceDescriptor.js';
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

describe('brud.core.utils service (brud.utilities@1)', () => {
  it('keeps its token and tier and declares one public exposure', () => {
    const descriptor = createUtilityDescriptor();

    assert.equal(descriptor.token.id, UtilityToken.id);
    assert.equal(descriptor.tier, UTILITY_SERVICE_TIER);
    assert.deepEqual(descriptor.dependencies, []);
    assert.deepEqual(descriptor.manifest?.exposures, [{ name: 'brud.utilities', version: 1, scope: 'runtime' }]);
  });

  it('resolves every language through the API served under brud.utilities', async () => {
    const root = join('/tmp', 'brud-utility-langs');
    const api: IUtilityService = new UtilityService();
    const tsProbe = virtualProbe(join(root, 'ts'), ['types.ts', 'b.ts', 'c/index.ts', 'e.ts', 'd.ts']);
    const jsProbe = virtualProbe(join(root, 'js'), ['types.js', 'b.js', 'c/index.js', 'e.js', 'd.js']);
    const pyFiles = new Set([join(root, 'py', '.helper.ts')]);

    const ts = await api.resolveImports(TS_CONTENT, { filePath: tsProbe.filePath, fileExists: tsProbe.fileExists });
    const js = await api.resolveImports(JS_CONTENT, jsProbe.filePath, jsProbe.fileExists);
    const py = await api.resolveImports(PY_CONTENT, {
      filePath: join(root, 'py', 'main.py'),
      fileExists: (candidate: string): boolean => pyFiles.has(candidate),
      language: 'python',
    });

    assert.deepEqual([...ts, ...js, ...py], [
      join(root, 'ts', 'types.ts'), join(root, 'ts', 'b.ts'), join(root, 'ts', 'c', 'index.ts'), join(root, 'ts', 'e.ts'), join(root, 'ts', 'd.ts'),
      join(root, 'js', 'types.js'), join(root, 'js', 'b.js'), join(root, 'js', 'c', 'index.js'), join(root, 'js', 'e.js'), join(root, 'js', 'd.js'),
      join(root, 'py', '.helper.ts'),
    ]);
  });

  it('returns the same array from a standalone service instance', async () => {
    const root = join('/tmp', 'brud-utility-standalone');
    const service: IUtilityService = new UtilityService();
    const files = new Set([join(root, 'standalone', 'b.ts')]);

    const result = await service.resolveImports("import { b } from './b';", {
      filePath: join(root, 'standalone', 'main.ts'),
      fileExists: (candidate: string): boolean => files.has(candidate),
    });

    assert.deepEqual(result, [join(root, 'standalone', 'b.ts')]);
  });
});
