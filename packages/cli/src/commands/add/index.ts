import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { flagOn, flagText, UsageError, type ParsedArgs } from '../../core/args.js';
import { readComposition, resolveConfigPath, type EntryInfo, type KernelPackage } from '../../composition/load.js';
import { CommandError } from '../../core/errors.js';
import type { Io } from '../../core/io.js';
import { assertSafeArgument, runNpm } from '../../core/npm.js';
import { loadPackage } from '../../core/project.js';
import { hasFailure, printFindings, type Finding, type Style } from '../../core/report.js';
import { entryPath, writeEntry } from './entry.js';
import { fetchTarball, isLocalSpec, npmErrorSummary, unpack } from './fetch.js';
import { inspectPackage } from './inspect.js';
import { lockedIntegrity, tarballIntegrity } from './integrity.js';
import type { Fetched, Inspected } from './types.js';

export const ADD_FLAGS = { boolean: ['dry-run', 'write', 'allow-scripts'], value: ['config'] } as const;

/** Installs the inspected package and reports whether the installed bytes are the ones inspected. */
async function install(io: Io, args: ParsedArgs, spec: string, fetched: Fetched): Promise<Finding> {
  const local = isLocalSpec(io.cwd, spec);
  const target = local ? resolve(io.cwd, spec) : `${fetched.name}@${fetched.version}`;
  const flags = flagOn(args, 'allow-scripts') ? [] : ['--ignore-scripts'];
  const result = await runNpm(['install', target, ...flags, '--no-audit', '--no-fund'], io.cwd);

  if (result.code !== 0) {
    throw new CommandError('ADD_INSTALL_FAILED', `npm install failed: ${npmErrorSummary(result.stderr)}`);
  }

  const isTarball = local && target.endsWith('.tgz');
  const expected = isTarball ? tarballIntegrity(target) : fetched.integrity;
  const locked = lockedIntegrity(io.cwd, fetched.name);
  const title = 'The installed package is the one that was inspected';

  if (locked === undefined || (local && !isTarball)) {
    return { id: 'add.integrity', title: 'Installed (the installed bytes were not compared with the inspected ones: local folder or no lockfile)', status: 'info' };
  }

  return locked === expected
    ? { id: 'add.integrity', title: `${title} (integrity matches)`, status: 'pass' }
    : { id: 'add.integrity', title, status: 'fail', cause: `the lockfile records ${locked} but the inspected tarball is ${expected}`, fix: `Remove it with \`npm uninstall ${fetched.name}\` and try again; the registry served different bytes.` };
}

/** `--write`: lists a caged, no-requires package as not official; anything else is left to the owner. */
function writeToComposition(args: ParsedArgs, inspected: Inspected, configPath: string, path: string): Finding | undefined {
  if (!flagOn(args, 'write')) {
    return undefined;
  }

  if (!(inspected.caged && !inspected.requiresOfficial)) {
    return { id: 'add.write', title: 'Not written to the composition', status: 'warn', cause: '--write adds only a not-official entry for a caged package; this one needs an official decision', fix: 'Review its code, then add the line below yourself if you trust it.' };
  }

  if (!existsSync(configPath)) {
    return { id: 'add.write', title: 'Not written to the composition', status: 'warn', cause: `no composition at ${configPath}`, fix: 'Create one with `brud init`, or pass --config <path>.' };
  }

  return { id: 'add.write', title: `${writeEntry(configPath, path) === 'added' ? 'Added' : 'Already listed:'} ${path} (not official) in ${configPath}`, status: 'pass' };
}

function advice(args: ParsedArgs, inspected: Inspected, configPath: string, path: string): string {
  if (inspected.caged && !inspected.requiresOfficial) {
    return `Add to "services" in ${configPath}${flagOn(args, 'write') ? ' (done)' : ''}: { "path": "${path}", "official": false }\nIt runs caged; it can only use what its manifest requests and the givers allow.`;
  }

  return `This package runs as trusted native code only if you declare it official. Review its code first. If you trust it, add: { "path": "${path}", "official": true }\nUntil then it is installed but not part of your composition.`;
}

async function loadKernelAndSdk(cwd: string): Promise<{ readonly kernel: KernelPackage; readonly isValidName: (name: string) => boolean }> {
  const kernel = (await loadPackage('@brud/kernel', cwd).catch(() => {
    throw new CommandError('PACKAGE_NOT_FOUND', '@brud/kernel is not installed here. Run `npm install @brud/kernel @brud/sdk` first.');
  })) as KernelPackage;
  const sdk = await loadPackage<{ isValidName(name: string): boolean }>('@brud/sdk', cwd).catch(() => {
    throw new CommandError('PACKAGE_NOT_FOUND', '@brud/sdk is not installed here. Run `npm install @brud/sdk` first.');
  });

  return { kernel, isValidName: sdk.module.isValidName };
}

/**
 * `brud add <package>`: adds a Brud participant package to this project.
 *
 * 1. Fetch the exact tarball into a scratch folder and inspect it without
 *    running or importing any of its code. A package that is not a Brud
 *    participant, is malformed, does not match its hash, does not fit your
 *    kernel or collides with your composition stops here; nothing is installed.
 * 2. Install that exact version with `npm install --ignore-scripts`, then check
 *    that the installed bytes are the ones that were inspected.
 * 3. Print the composition entry to add. It never declares anything official;
 *    `--write` adds a not-official entry for a caged package, and only that.
 */
export async function runAdd(io: Io, style: Style, args: ParsedArgs): Promise<number> {
  const spec = args.positionals[0];

  if (spec === undefined) {
    throw new UsageError('brud add needs a package: `brud add <name[@version] | ./file.tgz | ./folder>`');
  }

  assertSafeArgument(spec, 'package');

  if (!existsSync(join(io.cwd, 'package.json'))) {
    throw new CommandError('ADD_NO_PROJECT', 'there is no package.json here. Run `brud add` inside a project (create one with `brud init`).');
  }

  const { kernel, isValidName } = await loadKernelAndSdk(io.cwd);
  const configPath = resolveConfigPath(io.cwd, flagText(args, 'config'));
  const existing: readonly EntryInfo[] = existsSync(configPath) ? readComposition(kernel, configPath).entries : [];
  const scratch = await mkdtemp(join(tmpdir(), 'brud-cli-fetch-'));

  try {
    const fetched = await fetchTarball(spec, io.cwd, scratch);
    const inspected = await inspectPackage(kernel, isValidName, fetched, await unpack(fetched, scratch), flagOn(args, 'allow-scripts'), existing);
    const findings = [...inspected.findings];
    const summary = { name: fetched.name, version: fetched.version };

    if (hasFailure(findings) || flagOn(args, 'dry-run')) {
      findings.push({ id: 'add.result', title: hasFailure(findings) ? 'Nothing was installed' : 'Dry run: nothing was installed', status: 'info' });
      printFindings(io, style, findings, { ...summary, installed: false });

      return hasFailure(findings) ? 1 : 0;
    }

    findings.push(await install(io, args, spec, fetched));

    if (hasFailure(findings)) {
      printFindings(io, style, findings, { ...summary, installed: true });

      return 1;
    }

    const path = entryPath(configPath, io.cwd, fetched.name);
    const written = writeToComposition(args, inspected, configPath, path);

    if (written !== undefined) {
      findings.push(written);
    }

    findings.push({ id: 'add.result', title: `Installed ${fetched.name}@${fetched.version}`, status: 'pass' }, { id: 'add.next', title: advice(args, inspected, configPath, path), status: 'info' }, { id: 'add.verify', title: 'Then run `brud check` to confirm the composition boots', status: 'info' });
    printFindings(io, style, findings, { ...summary, installed: true, entry: { path, official: inspected.caged && !inspected.requiresOfficial ? false : null }, caged: inspected.caged, native: inspected.native, requiresOfficial: inspected.requiresOfficial });

    return hasFailure(findings) ? 1 : 0;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
