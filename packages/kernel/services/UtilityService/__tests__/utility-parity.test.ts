import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { UtilityService } from '../orchestrator/UtilityService.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE_RESOLVER_ENTRY = pathToFileURL(
  resolve(HERE, '../../../../core/src/import-resolver/index.ts'),
).href;

interface CoreResolverModule {
  resolveImports(
    content: string,
    filePath: string,
    fileExists: (path: string) => Promise<boolean>,
    customPatterns?: readonly string[],
  ): Promise<string[]>;
}

interface Fixture {
  readonly name: string;
  readonly filePath: string;
  readonly content: string;
  readonly files: readonly string[];
  readonly expected: readonly string[];
}

function fixture(
  name: string,
  root: string,
  fileName: string,
  content: string,
  files: readonly string[],
  expected: readonly string[] = files,
): Fixture {
  return {
    name,
    filePath: join(root, fileName),
    content,
    files: files.map((file) => join(root, file)),
    expected: expected.map((file) => join(root, file)),
  };
}

const TS_FIXTURE = fixture(
  'typescript',
  resolve('/virtual/brud-parity', 'ts'),
  'main.ts',
  [
    "import { helper } from './b';",
    "import type { Shape } from './types';",
    "import * as c from './c';",
    "const lazy = await import('./d');",
    "const req = require('./e');",
    "import React from 'react';",
  ].join('\n'),
  ['types.ts', 'b.ts', 'c/index.ts', 'e.ts', 'd.ts'],
);

const JS_FIXTURE = fixture(
  'javascript',
  resolve('/virtual/brud-parity', 'js'),
  'main.js',
  [
    "import { helper } from './b';",
    "import type { Shape } from './types';",
    "import * as c from './c';",
    "const lazy = await import('./d');",
    "const req = require('./e');",
    "import React from 'react';",
  ].join('\n'),
  ['types.js', 'b.js', 'c/index.js', 'e.js', 'd.js'],
);

const PYTHON_FIXTURE = fixture(
  'python',
  resolve('/virtual/brud-parity', 'py'),
  'main.py',
  [
    'import os',
    'from .helper import value',
    'from sys import argv',
  ].join('\n'),
  ['.helper.ts'],
);

// Python is deliberately excluded from the legacy-parity loop: the Utility
// Service fixes the legacy extension-selection bug instead of preserving it.
const PARITY_FIXTURES = [TS_FIXTURE, JS_FIXTURE];

describe('brud.core.utils parity with the legacy core resolver', () => {
  let core: CoreResolverModule;

  before(async () => {
    core = await import(CORE_RESOLVER_ENTRY) as CoreResolverModule;
  });

  for (const sample of PARITY_FIXTURES) {
    it(`matches the legacy resolver for the ${sample.name} sample`, async () => {
      const service = new UtilityService();
      const files = new Set(sample.files);
      const probe = async (candidate: string): Promise<boolean> => files.has(candidate);

      const legacy = await core.resolveImports(sample.content, sample.filePath, probe);
      const current = await service.resolveImports(sample.content, {
        filePath: sample.filePath,
        fileExists: probe,
      });
      const positional = await service.resolveImports(
        sample.content,
        sample.filePath,
        probe,
      );

      assert.deepEqual(current, legacy, 'named options form must match the legacy resolver');
      assert.deepEqual(positional, legacy, 'positional form must match the legacy resolver');
      assert.equal(
        JSON.stringify(current),
        JSON.stringify(legacy),
        'serialized output must be byte-identical',
      );
      assert.deepEqual(current, [...sample.expected]);
    });
  }

  it('Python default path resolves correctly (diverges from legacy bug)', async () => {
    const service = new UtilityService();
    const files = new Set(PYTHON_FIXTURE.files);
    const probe = async (candidate: string): Promise<boolean> => files.has(candidate);

    // Legacy still returns nothing because `getPatternsForFile` cannot select
    // `.py`; the Utility Service fixes that defect intentionally.
    const legacy = await core.resolveImports(
      PYTHON_FIXTURE.content,
      PYTHON_FIXTURE.filePath,
      probe,
    );
    const current = await service.resolveImports(PYTHON_FIXTURE.content, {
      filePath: PYTHON_FIXTURE.filePath,
      fileExists: probe,
    });
    const positional = await service.resolveImports(
      PYTHON_FIXTURE.content,
      PYTHON_FIXTURE.filePath,
      probe,
    );

    assert.deepEqual(legacy, [], 'legacy extension detection remains broken');
    assert.deepEqual(current, [...PYTHON_FIXTURE.expected]);
    assert.deepEqual(positional, [...PYTHON_FIXTURE.expected]);
  });

  it('routes Python patterns when an explicit language hint is supplied', async () => {
    const service = new UtilityService();
    const files = new Set(PYTHON_FIXTURE.files);
    const probe = async (candidate: string): Promise<boolean> => files.has(candidate);

    const resolved = await service.resolveImports(PYTHON_FIXTURE.content, {
      filePath: PYTHON_FIXTURE.filePath,
      fileExists: probe,
      language: 'python',
    });

    assert.deepEqual(resolved, [join(resolve('/virtual/brud-parity', 'py'), '.helper.ts')]);
  });

  it('matches the legacy resolver for custom import patterns', async () => {
    const root = resolve('/virtual/brud-parity', 'custom');
    const files = new Set([join(root, 'helper.custom')]);
    const probe = async (candidate: string): Promise<boolean> => files.has(candidate);
    const content = "import './helper.custom';";
    const patterns = ["import\\s+['\"]([^'\"]+)['\"]"];
    const service = new UtilityService();

    const legacy = await core.resolveImports(content, join(root, 'main.ts'), probe, patterns);
    const current = await service.resolveImports(content, {
      filePath: join(root, 'main.ts'),
      fileExists: probe,
      customPatterns: patterns,
    });

    assert.deepEqual(current, legacy);
    assert.deepEqual(current, [join(root, 'helper.custom')]);
  });
});

describe('Python extension detection', () => {
  it('recognizes .py by extension and resolves local imports on the default path', async () => {
    const service = new UtilityService();
    const root = resolve('/virtual/brud-python-detection', 'local');
    const files = new Set([join(root, '.helper.ts')]);
    const probe = async (candidate: string): Promise<boolean> => files.has(candidate);

    const resolved = await service.resolveImports(
      ['import os', 'from .helper import x'].join('\n'),
      {
        filePath: join(root, 'main.py'),
        fileExists: probe,
      },
    );

    assert.deepEqual(resolved, [join(root, '.helper.ts')]);
  });

  it('filters external-only Python imports on the default path', async () => {
    const service = new UtilityService();
    const root = resolve('/virtual/brud-python-detection', 'external');

    const resolved = await service.resolveImports('import os', {
      filePath: join(root, 'main.py'),
      fileExists: async (): Promise<boolean> => false,
    });

    assert.deepEqual(resolved, []);
  });
});