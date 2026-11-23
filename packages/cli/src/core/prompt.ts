import { createInterface } from 'node:readline';
import type { Io } from './io.js';
import type { Style } from './report.js';

/** Whether a person is at the keyboard: both streams are terminals and JSON output was not asked for. */
export function isInteractive(io: Io, style: Style): boolean {
  return io.isTty && (io.stdin as { isTTY?: boolean }).isTTY === true && !style.json;
}

/**
 * Asks a yes/no question and returns the answer. An empty answer takes the
 * default; anything that is not yes or no asks again, and a closed input takes
 * the default.
 */
export async function confirm(io: Io, question: string, defaultYes: boolean): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const lines = createInterface({ input: io.stdin, terminal: false });
  const next = (): Promise<string | undefined> => new Promise((resolve) => {
    lines.once('line', (line) => { resolve(line); });
    lines.once('close', () => { resolve(undefined); });
  });

  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      io.out(`${question} [${hint}] `);

      const answer = (await next())?.trim().toLowerCase();

      if (answer === undefined || answer === '') {
        return defaultYes;
      }

      if (answer === 'y' || answer === 'yes') {
        return true;
      }

      if (answer === 'n' || answer === 'no') {
        return false;
      }

      io.out('Please answer y or n.\n');
    }

    return defaultYes;
  } finally {
    lines.close();
  }
}
