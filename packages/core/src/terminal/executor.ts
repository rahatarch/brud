import { spawn } from 'child_process';
import type { TerminalExecutor, TerminalResult, GroupResult, ExecutedCommand, ConditionalCommand, CommandGroup } from './types';

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

export const executeCommand: TerminalExecutor['executeCommand'] = async (
  command: string,
  cwd?: string,
  timeout: number = 120000,
  env?: Record<string, string>,
): Promise<TerminalResult> => {
  const startTime = Date.now();
  const child = spawn(command, [], {
    shell: true,
    cwd: cwd || (() => { console.warn('Warning: cwd not resolved for executeCommand, falling back to process.cwd()'); return process.cwd(); })(),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: env ? { ...process.env, ...env } : undefined,
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

  const result = await new Promise<TerminalResult>((resolve) => {
    let resolved = false;

    child.on('close', (exitCode) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutHandle);
      const duration = Date.now() - startTime;
      const combinedOutput = stripAnsiCodes(stdout + stderr);
      if (timedOut) {
        resolve({ success: false, output: combinedOutput, exitCode: null, duration });
      } else {
        resolve({ success: exitCode === 0, output: combinedOutput, exitCode, duration });
      }
    });

    child.on('error', () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutHandle);
      const duration = Date.now() - startTime;
      resolve({ success: false, output: stripAnsiCodes(stdout + stderr), exitCode: null, duration });
    });
  });

  return result;
};

export const executeTerminalCommand: TerminalExecutor['execute'] = async (
  command: string,
  answers: string[],
  cwd?: string,
  timeout: number = 120000,
): Promise<TerminalResult> => {
  const startTime = Date.now();
  const child = spawn(command, [], {
    shell: true,
    cwd: cwd || (() => { console.warn('Warning: cwd not resolved for execute, falling back to process.cwd()'); return process.cwd(); })(),
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
      const duration = Date.now() - startTime;
      const combinedOutput = stripAnsiCodes(stdout + stderr);
      if (timedOut) {
        resolve({ success: false, output: combinedOutput, exitCode: null, duration });
      } else {
        resolve({ success: exitCode === 0, output: combinedOutput, exitCode, duration });
      }
    });

    child.on('error', () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutHandle);
      const duration = Date.now() - startTime;
      resolve({ success: false, output: stripAnsiCodes(stdout + stderr), exitCode: null, duration });
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

export const executeSequential: TerminalExecutor['executeSequential'] = async (
  commands: string[],
  cwd?: string,
  timeout: number = 120000,
  env?: Record<string, string>,
  stopOnFailure?: boolean,
): Promise<GroupResult> => {
  const results: ExecutedCommand[] = [];
  let overallSuccess = true;

  for (const command of commands) {
    const result = await executeCommand(command, cwd, timeout, env);
    results.push({
      command,
      success: result.success,
      output: result.output,
      exitCode: result.exitCode,
      duration: result.duration,
    });

    if (!result.success && stopOnFailure) {
      overallSuccess = false;
      break;
    }
  }

  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  const success = results.every(r => r.success) && overallSuccess;

  return { success, results, totalDuration };
};

export const executeParallel: TerminalExecutor['executeParallel'] = async (
  commands: string[],
  cwd?: string,
  timeout: number = 120000,
  env?: Record<string, string>,
): Promise<GroupResult> => {
  const results = await Promise.all(
    commands.map(async (command) => {
      const result = await executeCommand(command, cwd, timeout, env);
      return {
        command,
        success: result.success,
        output: result.output,
        exitCode: result.exitCode,
        duration: result.duration,
      };
    }),
  );

  const totalDuration = Math.max(...results.map(r => r.duration));
  const success = results.every(r => r.success);

  return { success, results, totalDuration };
};

async function executeCommandGroup(
  group: CommandGroup,
  cwd?: string,
  timeout?: number,
  env?: Record<string, string>,
): Promise<GroupResult> {
  const stringCommands: string[] = [];
  const subGroups: { group: CommandGroup; index: number }[] = [];

  for (let i = 0; i < group.commands.length; i++) {
    const cmd = group.commands[i];
    if (typeof cmd === 'string') {
      stringCommands.push(cmd);
    } else {
      subGroups.push({ group: cmd, index: i });
    }
  }

  const allResults: { index: number; result: ExecutedCommand }[] = [];
  let overallSuccess = true;

  if (stringCommands.length > 0) {
    let groupResult: GroupResult;
    if (group.type === 'parallel') {
      groupResult = await executeParallel(stringCommands, cwd, timeout, env);
    } else {
      groupResult = await executeSequential(stringCommands, cwd, timeout, env, group.stopOnFailure);
    }
    groupResult.results.forEach((r, idx) => {
      allResults.push({ index: idx, result: r });
    });
    if (!groupResult.success) {
      overallSuccess = false;
    }
  }

  for (const sg of subGroups) {
    const subResult = await executeCommandGroup(sg.group, cwd, timeout, env);
    subResult.results.forEach((r) => {
      allResults.push({ index: sg.index, result: r });
    });
    if (!subResult.success) {
      overallSuccess = false;
    }
  }

  allResults.sort((a, b) => a.index - b.index);
  const results = allResults.map(r => r.result);
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  const success = results.every(r => r.success) && overallSuccess;

  return { success, results, totalDuration };
}

export const executeConditional: TerminalExecutor['executeConditional'] = async (
  conditional: ConditionalCommand,
  cwd?: string,
  timeout: number = 120000,
  env?: Record<string, string>,
): Promise<GroupResult> => {
  const primaryResult = await executeCommand(conditional.command, cwd, timeout, env);
  const allResults: ExecutedCommand[] = [
    {
      command: conditional.command,
      success: primaryResult.success,
      output: primaryResult.output,
      exitCode: primaryResult.exitCode,
      duration: primaryResult.duration,
    },
  ];

  let conditionalResults: ExecutedCommand[] = [];

  if (primaryResult.success && conditional.onSuccess) {
    const gr = await executeCommandGroup(conditional.onSuccess, cwd, timeout, env);
    conditionalResults = gr.results;
  } else if (!primaryResult.success && conditional.onFailure) {
    const gr = await executeCommandGroup(conditional.onFailure, cwd, timeout, env);
    conditionalResults = gr.results;
  }

  allResults.push(...conditionalResults);
  const totalDuration = allResults.reduce((sum, r) => sum + r.duration, 0);
  const success = allResults.every(r => r.success);

  return { success, results: allResults, totalDuration };
};