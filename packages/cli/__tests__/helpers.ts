import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { main } from '../src/main.js';
import type { Io } from '../src/io.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

/** The tests' project folders: temp folders whose `@brud/*` packages link to this workspace. */
export interface TestProject {
  readonly dir: string;
  readonly cleanup: () => void;
}

export function makeProject(): TestProject {
  const dir = mkdtempSync(join(tmpdir(), 'brud-cli-test-'));

  mkdirSync(join(dir, 'node_modules', '@brud'), { recursive: true });

  for (const name of ['kernel', 'sdk', 'daemon']) {
    symlinkSync(join(REPO, 'packages', name), join(dir, 'node_modules', '@brud', name), 'junction');
  }

  return { dir, cleanup: () => { rmSync(dir, { recursive: true, force: true }); } };
}

export interface Result {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

/** Runs `brud <argv>` in `cwd` with the given stdin text. */
export async function brud(cwd: string, argv: readonly string[], stdin = '', env: NodeJS.ProcessEnv = {}): Promise<Result> {
  let out = '';
  let err = '';
  const input = new PassThrough();
  const io: Io = {
    out: (text) => { out += text; },
    err: (text) => { err += text; },
    cwd,
    env: { ...process.env, ...env },
    stdin: input,
    isTty: false,
  };

  input.end(stdin);

  const code = await main(argv, io);

  return { code, out, err };
}

/** Every file under `dir` (relative, sorted), for proving a command wrote nothing. */
export function listTree(dir: string): string[] {
  const found: string[] = [];
  const walk = (folder: string): void => {
    for (const name of readdirSync(folder)) {
      const full = join(folder, name);

      if (statSync(full).isDirectory()) {
        if (name !== 'node_modules') {
          walk(full);
        }
      } else {
        found.push(relative(dir, full));
      }
    }
  };

  walk(dir);

  return found.sort();
}

/** Runs the scaffold's own tests, as `npm test` does. */
export function runNodeTests(cwd: string): { readonly status: number | null; readonly output: string } {
  const result = spawnSync(process.execPath, ['--test'], { cwd, encoding: 'utf8' });

  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/** A hand-assembled caged guest (WebAssembly) that answers every call `{"ok":true,"value":"hi"}`. */
export const GUEST_WASM_HEX = '0061736d01000000010c0260017f017f60027f7f017e03030200010503010001072503066d656d6f727902000a627275645f616c6c6f6300000b627275645f696e766f6b6500010a120205004180200b0a0042988080808080010b0b1f01004180080b187b226f6b223a747275652c2276616c7565223a226869227d';

export function writeGuestFolder(dir: string, extra: Readonly<Record<string, unknown>> = {}): void {
  writeFileSync(join(dir, 'guest.wasm'), Buffer.from(GUEST_WASM_HEX, 'hex'));
  writeFileSync(join(dir, 'brud.participant.src.json'), JSON.stringify({
    id: 'acme.caged',
    manifest: { requests: { capabilities: [] }, exposures: [{ name: 'acme.caged.read', version: 1, scope: 'any', policy: { policyVersion: 2, capabilities: ['caged:read'] } }] },
    limits: { fuel: 1_000_000, maxMemoryBytes: 16_777_216, deadlineMs: 5000 },
    guest: { module: 'guest.wasm' },
    ...extra,
  }));
}
