#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const servicesRoot = join(repositoryRoot, 'packages', 'services');

/** Source entries for the host-side standard composition used by tests. */
const ENTRIES = [
  'SettingsService/serviceModule.ts',
  'SettingsService/settingsReader.ts',
  'UtilityService/serviceModule.ts',
  'ExposedApiRegistry/serviceModule.ts',
  'BrandRegistry/serviceModule.ts',
  'WorkspaceService/serviceModule.ts',
  'BrudFileSystem/serviceModule.ts',
  'ValidationService/serviceModule.ts',
  'TerminalService/serviceModule.ts',
  'Parser/serviceModule.ts',
  'Router/serviceModule.ts',
  'BrudTools/serviceModule.ts',
  'ActionManager/serviceModule.ts',
  'UniversalHistory/historySession.ts',
  'UniversalHistory/historyJournal.ts',
  'PluginManager/serviceModule.ts',
];

/**
 * Writes an absolute-path standard config beside the service packages.
 *
 * The kernel package ships only hardcore services. Hosts and tests that want
 * the standard set compose it from the service packages. Absolute paths make
 * the document portable when a test copies it into a temporary directory.
 */
export function writeStandardConfig() {
  const configPath = join(servicesRoot, 'standard.config.json');
  const services = [
    ...ENTRIES.map((entry) => ({
      path: join(servicesRoot, entry),
      official: true,
    })),
    { path: 'kernel:serviceModules/identityRegistry.js', official: true },
  ];

  writeFileSync(
    configPath,
    `${JSON.stringify({ services, plugins: [] }, null, 2)}\n`,
    'utf8',
  );

  return configPath;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`Wrote ${writeStandardConfig()}\n`);
}
