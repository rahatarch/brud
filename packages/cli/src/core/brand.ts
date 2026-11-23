import type { Io } from './io.js';
import { readOwnPackage } from './project.js';

/** The letters of the BrudOS wordmark, five rows each. */
const LETTERS: readonly (readonly string[])[] = [
  [' ____  ', '| __ ) ', '|  _ \\ ', '| |_) |', '|____/ '],
  [' ____  ', '|  _ \\ ', '| |_) |', '|  _ < ', '|_| \\_\\'],
  [' _   _ ', '| | | |', '| | | |', '| |_| |', ' \\___/ '],
  [' ____  ', '|  _ \\ ', '| | | |', '| |_| |', '|____/ '],
  ['  ___  ', ' / _ \\ ', '| | | |', '| |_| |', ' \\___/ '],
  [' ____  ', '/ ___| ', '\\___ \\ ', ' ___) |', '|____/ '],
];

/** The BrudOS wordmark. */
const LOGO: readonly string[] = [0, 1, 2, 3, 4].map((row) => LETTERS.map((letter) => letter[row]).join(''));

const CYAN = '36';

/** Whether to print the brand: only for a person at a terminal, never into a pipe or a script. */
export function showsBrand(io: Io, argv: readonly string[]): boolean {
  return io.isTty && !argv.includes('--json');
}

/** The wordmark, in colour when the terminal takes it. */
export function logo(io: Io, argv: readonly string[]): string {
  const color = io.env.NO_COLOR === undefined && !argv.includes('--no-color');
  const lines = LOGO.map((line) => line.trimEnd());

  return `${(color ? lines.map((line) => `\x1b[${CYAN}m${line}\x1b[0m`) : lines).join('\n')}\n`;
}

/** Version, licence and credits, printed under the wordmark. */
export function about(): string {
  const pkg = readOwnPackage();

  return [
    `Brud CLI ${pkg.version}`,
    `License: ${pkg.license ?? 'see the package'}`,
    '© 2026 Brud Foundation. All rights reserved.',
    ...(pkg.homepage === undefined ? [] : [pkg.homepage]),
    '',
  ].join('\n');
}
