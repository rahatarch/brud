import { spawn } from 'child_process';
import type { TerminalExecutor, TerminalResult } from './types';

function stripAnsiCodes(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1B\][0-9;]*\x07/g, '')
    .replace(/\x1B\].*?\x1B\\/g, '')
    .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x08/g, '')
    .replace(/\x1B\[K/g, '')
    .replace(/\r/g, '');
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const executeTerminalCommand: TerminalExecutor['execute'] = async (
  command: string,
  answers: string[],
  cwd?: string,
  timeout: number = 120000,
): Promise<TerminalResult> => {
  const child = spawn(command, [], {
    shell: true,
    cwd: cwd || process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let timedOut = false;

  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeout);

  child.stdout?.on('data', (data: Buffer) => {
    stdout += data.toString();
  });

  child.stderr?.on('data', (data: Buffer) => {
    stderr += data.toString();
  });

  const processDone = new Promise<TerminalResult>((resolve) => {
    let resolved = false;

    child.on('close', (exitCode) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutHandle);
      const combinedOutput = stripAnsiCodes(stdout + stderr);
      if (timedOut) {
        resolve({ success: false, output: combinedOutput, exitCode: null });
      } else {
        resolve({ success: exitCode === 0, output: combinedOutput, exitCode });
      }
    });

    child.on('error', () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutHandle);
      resolve({ success: false, output: stripAnsiCodes(stdout + stderr), exitCode: null });
    });
  });

  await delay(1000);

  for (const answer of answers) {
    try {
      child.stdin?.write(answer + '\n');
    } catch {
      // process may have already exited
    }
    await delay(500);
  }

  try {
    child.stdin?.end();
  } catch {
    // process may have already exited
  }

  return processDone;
};