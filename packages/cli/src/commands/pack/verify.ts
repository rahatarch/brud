import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asHost, bootFailure, hardcoreModulePaths, withScratchKernel, type KernelPackage } from '../../composition/load.js';
import type { Finding } from '../../core/report.js';
import { isRecord, type Source } from './source.js';

/** Boots a scratch kernel with the package (not official) and resolves every exposure it declares. */
export async function verifyPackage(kernel: KernelPackage, manifestPath: string, source: Source): Promise<Finding[]> {
  const exposures = (source.manifest.exposures as unknown[]).filter(isRecord);
  const scratch = await mkdtemp(join(tmpdir(), 'brud-cli-pack-'));

  try {
    const configPath = join(scratch, 'brud.config.json');
    const services = [...hardcoreModulePaths(kernel.root).map((path) => ({ path, official: true })), { path: manifestPath, official: false }];

    await writeFile(configPath, JSON.stringify({ services }), 'utf8');

    return await withScratchKernel(kernel, configPath, {}, async (booted) => {
      const findings: Finding[] = [{ id: 'verify.boot', title: 'The package boots in a scratch kernel as a caged, not-official participant', status: 'pass' }];

      for (const exposure of exposures) {
        const name = String(exposure.name);
        const policy = isRecord(exposure.policy) ? exposure.policy : {};
        const needed = Array.isArray(policy.capabilities) ? policy.capabilities.filter((item): item is string => typeof item === 'string') : [];
        const resolves = (capabilities: readonly string[]): Promise<boolean> => asHost(kernel, booted, capabilities, (registry) => registry.resolve(name) !== null);
        const withCaps = await resolves(needed);
        const without = needed.length === 0 ? withCaps : await resolves([]);

        findings.push(!withCaps
          ? { id: `verify.${name}`, title: `Exposure ${name} resolves for a caller holding ${needed.length === 0 ? 'no capabilities' : needed.join(', ')}`, status: 'fail', cause: 'the exposure did not resolve', fix: 'Check the manifest exposure (name, version, scope, policy) and that the guest exports brud_alloc and brud_invoke.' }
          : needed.length > 0 && without
            ? { id: `verify.${name}`, title: `Exposure ${name} resolves, but also without its capabilities`, status: 'warn', cause: 'its policy asked for capabilities yet a caller with none resolved it', fix: 'Check the exposure policy (policyVersion 2, capabilities).' }
            : { id: `verify.${name}`, title: `Exposure ${name} resolves${needed.length === 0 ? '' : ` only with ${needed.join(', ')}`}`, status: 'pass' });
      }

      return findings;
    });
  } catch (error: unknown) {
    return [bootFailure('verify.boot', 'The package boots in a scratch kernel', error)];
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
